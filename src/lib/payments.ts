import crypto from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db/client";
import { paymentEvents, payments, type PaymentRow } from "@/db/schema";
import { findCreditPack } from "@/lib/credit-packs";
import { recordTopUp } from "@/lib/ella-credits";
import { appendAccountLedgerEntryOnExecutor, organizationCreditsEnabled } from "@/lib/ella-credits-accounts";
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
  organizationId: string;
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
      organizationId: input.organizationId,
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
      purpose: `Smile Credits — ${pack.credits} credits`,
      redirectUrl: `${origin}/credits?payment=return&ref=${encodeURIComponent(reference)}`,
      webhookUrl: `${origin}/api/webhooks/hitpay`,
    });
  } catch (error) {
    console.error("[Payments] HitPay create failed:", error instanceof Error ? error.message : String(error));
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
  /** HitPay payment-request id (top-level `id` in the JSON webhook). */
  providerPaymentId: string;
  /** HitPay charge/payment id (nested `payments[0].id` in the JSON webhook). */
  providerReference?: string;
  rawStatus: string;
  amountMajor: string; // decimal string from the provider
  currency: string;
  signatureValid: boolean;
  source: "webhook" | "reconcile";
  raw: Record<string, unknown>;
};

export type ProviderUpdateResult = {
  ok: boolean;
  outcome: "credited" | "already_processed" | "not_paid" | "amount_mismatch" | "provider_mismatch" | "unknown_payment" | "grant_deferred";
  status: string;
};

export async function handleProviderUpdate(update: ProviderUpdate): Promise<ProviderUpdateResult> {
  const db = getDb();
  const [payment] = await db.select().from(payments).where(eq(payments.reference, update.reference)).limit(1);
  if (!payment) return { ok: false, outcome: "unknown_payment", status: "" };

  const mapped = mapHitpayStatus(update.rawStatus);
  const dedupeKey = `${payment.reference}:${update.providerPaymentId || "?"}:${mapped}:${update.source}`;

  // The reference resolves our order. The payment-request id and the charge
  // id are independently checked when HitPay supplies them, so a valid
  // signature cannot be used to credit a different internal order.
  if (
    (payment.providerPaymentId && update.providerPaymentId && payment.providerPaymentId !== update.providerPaymentId) ||
    (payment.providerReference && update.providerReference && payment.providerReference !== update.providerReference)
  ) {
    await db.update(payments).set({ lastEvent: { ...update.raw, providerMismatch: true }, updatedAt: new Date() }).where(eq(payments.id, payment.id));
    return { ok: false, outcome: "provider_mismatch", status: payment.status };
  }

  if (mapped !== "paid") {
    // A refund is a real provider state transition. This records it for
    // reconciliation/audit, but intentionally does not remove credits
    // automatically because the portal has no approved refund policy yet.
    await db.insert(paymentEvents).values({
      paymentId: payment.id,
      source: update.source,
      event: `provider_${mapped}`,
      status: mapped,
      signatureValid: update.signatureValid,
      dedupeKey,
      detail: update.raw,
    }).catch((error) => {
      if (isPaymentEventDedupeConflict(error)) {
        return;
      }
      throw error;
    });

    if (payment.status === "paid" && mapped !== "refunded") {
      return { ok: true, outcome: "already_processed", status: payment.status };
    }
    await db.update(payments).set({
      providerReference: update.providerReference || payment.providerReference,
      lastEvent: update.raw,
      status: mapped,
      updatedAt: new Date(),
    }).where(eq(payments.id, payment.id));
    return { ok: true, outcome: "not_paid", status: mapped };
  }

  // Amount integrity — the provider must echo the amount WE set. A mismatch is
  // never credited (guards against a tampered payment link).
  const providerCents = parseProviderAmountCents(update.amountMajor);
  if (
    !update.providerPaymentId ||
    providerCents === null ||
    providerCents !== payment.amountCents ||
    update.currency.trim().toUpperCase() !== payment.currency.toUpperCase()
  ) {
    await db
      .update(payments)
      .set({ status: "failed", updatedAt: new Date(), lastEvent: { ...update.raw, amountMismatch: true } })
      .where(eq(payments.id, payment.id));
    console.error(`[Payments] Amount validation failed for order ${payment.reference}.`);
    return { ok: false, outcome: "amount_mismatch", status: "failed" };
  }

  if (organizationCreditsEnabled()) {
    // The Pilot's organization wallet and payment row share the same Neon
    // database. Locking the payment row and writing the ledger through the
    // same transaction makes webhook/reconcile races atomic.
    try {
      await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(payments).where(eq(payments.id, payment.id)).for("update").limit(1);
        if (!locked) throw new Error("Payment disappeared during settlement.");
        if (locked.creditedAt && locked.status === "paid") return;

        try {
          await tx.insert(paymentEvents).values({
            paymentId: locked.id,
            source: update.source,
            event: "provider_paid",
            status: "paid",
            signatureValid: update.signatureValid,
            dedupeKey,
            detail: update.raw,
          });
        } catch (error) {
          if (isPaymentEventDedupeConflict(error)) {
            // Another source may have recorded the same provider event; the
            // deterministic ledger key still makes this grant idempotent.
          } else {
            throw error;
          }
        }

        const creditLedgerSourceId = `LDG-${crypto.createHash("sha256").update(grantKeyFor(locked.reference)).digest("hex")}`;
        await appendAccountLedgerEntryOnExecutor(tx, {
          organizationId: locked.organizationId,
          ownerEmail: "org",
          entry: {
            type: "TopUp",
            event: "purchase",
            units: locked.credits,
            creditsDelta: locked.credits,
            reference: locked.reference,
            actorName: locked.actorName,
            actorEmail: locked.actorEmail,
            note: `HitPay purchase ${locked.reference} (${locked.packId || "custom"})`,
            sourceEntryId: creditLedgerSourceId,
          },
        });
        await tx.update(payments).set({
          providerReference: update.providerReference || locked.providerReference,
          status: "paid",
          paidAt: locked.paidAt ?? new Date(),
          creditedAt: new Date(),
          creditLedgerSourceId,
          lastEvent: update.raw,
          updatedAt: new Date(),
        }).where(eq(payments.id, locked.id));
      });
      return { ok: true, outcome: payment.creditedAt ? "already_processed" : "credited", status: "paid" };
    } catch (error) {
      console.error(`[Payments] Atomic ledger grant deferred for order ${payment.reference}:`, error instanceof Error ? error.message : "database error");
      return { ok: true, outcome: "grant_deferred", status: "paid" };
    }
  }

  // Legacy Sheets/dual deployments retain the existing idempotent ledger
  // adapter. The deterministic source key still prevents duplicate credits;
  // atomic settlement is available once the Pilot uses organization wallets.
  try {
    await recordTopUp({
      amount: payment.credits,
      event: "purchase",
      reference: payment.reference,
      idempotencyKey: grantKeyFor(payment.reference),
      actorName: payment.actorName,
      actorEmail: payment.actorEmail,
      organizationId: payment.organizationId,
      note: `HitPay purchase ${payment.reference} (${payment.packId || "custom"})`,
    });
  } catch (error) {
    console.error(`[Payments] Ledger grant deferred for order ${payment.reference}:`, error instanceof Error ? error.message : "ledger error");
    return { ok: true, outcome: "grant_deferred", status: "paid" };
  }

  await db.update(payments).set({
    providerReference: update.providerReference || payment.providerReference,
    status: "paid",
    paidAt: payment.paidAt ?? new Date(),
    creditedAt: new Date(),
    creditLedgerSourceId: `LDG-${crypto.createHash("sha256").update(grantKeyFor(payment.reference)).digest("hex")}`,
    lastEvent: update.raw,
    updatedAt: new Date(),
  }).where(eq(payments.id, payment.id));

  return { ok: true, outcome: payment.creditedAt ? "already_processed" : "credited", status: "paid" };
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
    providerPaymentId: request.id || payment.providerPaymentId,
    providerReference: firstPayment?.id,
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
