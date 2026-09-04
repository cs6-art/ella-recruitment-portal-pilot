import crypto from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db/client";
import { paymentEvents, payments, type PaymentRow } from "@/db/schema";
import { findCreditPack } from "@/lib/credit-packs";
import { recordTopUp } from "@/lib/ella-credits";
import { isPaymentEventDedupeConflict, parseProviderAmountCents } from "@/lib/payment-validation";
import {
  createPaymentRequest,
  getPaymentRequest,
  isHitpayConfigured,
  mapHitpayStatus,
} from "@/lib/hitpay";

/**
 * Credit-purchase orchestration.
 *
 * Flow: create a `payments` row (pending) → HitPay payment request → user pays
 * → HitPay webhook (signature-verified by the route) → `handleProviderUpdate`
 * marks the row paid and grants credits through the idempotent ledger.
 *
 * A frontend redirect never grants credits — only `handleProviderUpdate` does,
 * and only after a verified `paid` signal. The ledger grant uses the
 * deterministic key `payment:<reference>` so a duplicate webhook, a webhook +
 * a reconcile, or a retry after a transient ledger error all converge on
 * exactly one grant. `payment_events.dedupe_key` gives a second guard at the
 * event layer.
 */

export function isPaymentsConfigured(): boolean {
  return isDatabaseConfigured() && isHitpayConfigured();
}

const grantKeyFor = (reference: string) => `payment:${reference}`;

export type CreatePurchaseInput = {
  packId: string;
  actorEmail: string;
  actorName: string;
  origin: string;
  /** Optional caller idempotency key (e.g. an Idempotency-Key header). */
  idempotencyKey?: string;
};

export type CreatePurchaseResult = {
  reference: string;
  url: string;
  amountCents: number;
  currency: string;
  credits: number;
  reused: boolean;
};

export async function createCreditPurchase(input: CreatePurchaseInput): Promise<CreatePurchaseResult> {
  const pack = findCreditPack(input.packId);
  if (!pack) throw new PaymentError("UNKNOWN_PACK", "That credit pack is not available.");

  const db = getDb();

  if (input.idempotencyKey) {
    const [existing] = await db.select().from(payments).where(eq(payments.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing) {
      const url = (existing.lastEvent as { url?: string } | null)?.url || "";
      return {
        reference: existing.reference,
        url,
        amountCents: existing.amountCents,
        currency: existing.currency,
        credits: existing.credits,
        reused: true,
      };
    }
  }

  const reference = `PAY-${crypto.randomUUID()}`;
  const [row] = await db
    .insert(payments)
    .values({
      reference,
      provider: "hitpay",
      status: "pending",
      amountCents: pack.amountCents,
      currency: pack.currency,
      credits: pack.credits,
      packId: pack.id,
      actorEmail: input.actorEmail.trim().toLowerCase(),
      actorName: input.actorName,
      idempotencyKey: input.idempotencyKey || null,
    })
    .returning();

  const origin = input.origin.replace(/\/+$/, "");
  let request;
  try {
    request = await createPaymentRequest({
      amountCents: pack.amountCents,
      currency: pack.currency,
      referenceNumber: reference,
      email: input.actorEmail,
      name: input.actorName,
      purpose: `Ella Credits — ${pack.credits} credits`,
      redirectUrl: `${origin}/credits?payment=return&ref=${encodeURIComponent(reference)}`,
      webhookUrl: `${origin}/api/webhooks/hitpay`,
    });
  } catch (error) {
    await db
      .update(payments)
      .set({ status: "failed", updatedAt: new Date(), lastEvent: { error: String(error instanceof Error ? error.message : error) } })
      .where(eq(payments.id, row.id));
    throw new PaymentError("PROVIDER_ERROR", "Could not start the payment. Please try again.");
  }

  await db
    .update(payments)
    .set({ providerPaymentId: request.id, updatedAt: new Date(), lastEvent: { url: request.url, status: request.status } })
    .where(eq(payments.id, row.id));

  await db.insert(paymentEvents).values({
    paymentId: row.id,
    source: "create",
    event: "payment_request_created",
    status: "pending",
    signatureValid: true,
    dedupeKey: `${reference}:create`,
    detail: { providerPaymentId: request.id },
  });

  return { reference, url: request.url, amountCents: pack.amountCents, currency: pack.currency, credits: pack.credits, reused: false };
}

export type ProviderUpdate = {
  reference: string;
  providerPaymentId: string;
  rawStatus: string;
  amountMajor: string; // decimal string from the provider
  currency: string;
  signatureValid: boolean;
  source: "webhook" | "reconcile";
  raw: Record<string, unknown>;
};

export type ProviderUpdateResult = {
  ok: boolean;
  outcome: "credited" | "already_processed" | "not_paid" | "amount_mismatch" | "unknown_payment" | "grant_deferred";
  status: string;
};

export async function handleProviderUpdate(update: ProviderUpdate): Promise<ProviderUpdateResult> {
  const db = getDb();
  const [payment] = await db.select().from(payments).where(eq(payments.reference, update.reference)).limit(1);
  if (!payment) return { ok: false, outcome: "unknown_payment", status: "" };

  const mapped = mapHitpayStatus(update.rawStatus);
  const dedupeKey = `${payment.reference}:${update.providerPaymentId || "?"}:${mapped}:${update.source}`;

  // Event-layer idempotency: a replayed webhook is a no-op insert.
  try {
    await db.insert(paymentEvents).values({
      paymentId: payment.id,
      source: update.source,
      event: `provider_${mapped}`,
      status: mapped,
      signatureValid: update.signatureValid,
      dedupeKey,
      detail: update.raw,
    });
  } catch (error) {
    if (isPaymentEventDedupeConflict(error)) {
      return { ok: true, outcome: "already_processed", status: payment.status };
    }
    throw error;
  }

  await db
    .update(payments)
    .set({ providerReference: update.providerPaymentId || payment.providerReference, lastEvent: update.raw, updatedAt: new Date() })
    .where(eq(payments.id, payment.id));

  if (mapped !== "paid") {
    if (payment.status === "paid" || payment.status === "refunded") {
      return { ok: true, outcome: "already_processed", status: payment.status };
    }
    await db.update(payments).set({ status: mapped, updatedAt: new Date() }).where(eq(payments.id, payment.id));
    return { ok: true, outcome: "not_paid", status: mapped };
  }

  // Amount integrity — the provider must echo the amount WE set. A mismatch is
  // never credited (guards against a tampered payment link).
  const providerCents = parseProviderAmountCents(update.amountMajor);
  if (
    providerCents === null ||
    providerCents !== payment.amountCents ||
    update.currency.trim().toUpperCase() !== payment.currency.toUpperCase()
  ) {
    await db
      .update(payments)
      .set({ status: "failed", updatedAt: new Date(), lastEvent: { ...update.raw, amountMismatch: true } })
      .where(eq(payments.id, payment.id));
    console.error(`[Payments] Amount validation failed on ${payment.reference}: expected ${payment.amountCents} ${payment.currency}, provider ${providerCents ?? "invalid"} ${update.currency}`);
    return { ok: false, outcome: "amount_mismatch", status: "failed" };
  }

  // Already credited (idempotent re-entry) — nothing to do.
  if (payment.creditedAt && payment.status === "paid") {
    return { ok: true, outcome: "already_processed", status: "paid" };
  }

  await db.update(payments).set({ status: "paid", paidAt: payment.paidAt ?? new Date(), updatedAt: new Date() }).where(eq(payments.id, payment.id));

  // Grant the credits through the idempotent ledger. Deterministic key ⇒ a
  // duplicate webhook / a reconcile / a retry after a transient error all land
  // on exactly one grant.
  try {
    await recordTopUp({
      amount: payment.credits,
      event: "purchase",
      reference: payment.reference,
      idempotencyKey: grantKeyFor(payment.reference),
      actorName: payment.actorName,
      actorEmail: payment.actorEmail,
      note: `HitPay purchase ${payment.reference} (${payment.packId || "custom"})`,
    });
  } catch (error) {
    // Payment stays 'paid' but un-credited; a later reconcile retries safely.
    console.error(`[Payments] Ledger grant deferred for ${payment.reference}:`, error);
    return { ok: true, outcome: "grant_deferred", status: "paid" };
  }

  await db
    .update(payments)
    .set({ creditedAt: new Date(), creditLedgerSourceId: `LDG-${crypto.createHash("sha256").update(grantKeyFor(payment.reference)).digest("hex")}`, updatedAt: new Date() })
    .where(eq(payments.id, payment.id));

  return { ok: true, outcome: "credited", status: "paid" };
}

/** Pull the current status from HitPay and re-run the transition (admin / cron). */
export async function reconcilePayment(reference: string): Promise<ProviderUpdateResult> {
  const db = getDb();
  const [payment] = await db.select().from(payments).where(eq(payments.reference, reference)).limit(1);
  if (!payment) return { ok: false, outcome: "unknown_payment", status: "" };
  if (!payment.providerPaymentId) return { ok: false, outcome: "unknown_payment", status: payment.status };

  const request = await getPaymentRequest(payment.providerPaymentId);
  const firstPayment = request.payments[0] as { id?: string; status?: string; amount?: string; currency?: string } | undefined;
  return handleProviderUpdate({
    reference,
    providerPaymentId: firstPayment?.id || payment.providerPaymentId,
    rawStatus: firstPayment?.status || request.status,
    amountMajor: firstPayment?.amount || request.amount,
    currency: firstPayment?.currency || request.currency || payment.currency,
    signatureValid: true,
    source: "reconcile",
    raw: request as unknown as Record<string, unknown>,
  });
}

export async function listRecentPayments(limit = 50): Promise<PaymentRow[]> {
  const db = getDb();
  return db.select().from(payments).orderBy(desc(payments.createdAt)).limit(Math.min(Math.max(limit, 1), 200));
}

export async function getPaymentByReference(reference: string): Promise<PaymentRow | null> {
  const db = getDb();
  const [row] = await db.select().from(payments).where(eq(payments.reference, reference)).limit(1);
  return row ?? null;
}

export async function getPaymentForActor(reference: string, actorEmail: string): Promise<PaymentRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.reference, reference), eq(payments.actorEmail, actorEmail.trim().toLowerCase())))
    .limit(1);
  return row ?? null;
}

export class PaymentError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
  }
}
