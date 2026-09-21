import { NextResponse } from "next/server";

import { handleProviderUpdate, isPaymentsConfigured } from "@/lib/payments";
import { verifyFormWebhook, verifyJsonWebhook } from "@/lib/hitpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * HitPay webhook. The ONLY server-trusted signal that a payment succeeded.
 *
 * - Signature is verified before anything else (classic salted form HMAC, or a
 *   raw-body HMAC header for the JSON webhook). An invalid/missing signature is
 *   401 and changes nothing.
 * - Processing is idempotent: a replayed webhook, or a webhook racing a
 *   reconcile, credits at most once (deterministic ledger key + a unique
 *   `payment_events.dedupe_key`).
 * - We always answer 200 on a verified callback so HitPay stops retrying, even
 *   when our follow-up ledger write is deferred.
 */
export async function POST(request: Request) {
  if (!isPaymentsConfigured()) {
    // Nothing to do, but don't make HitPay hammer us.
    return NextResponse.json({ received: true, configured: false });
  }

  const raw = await request.text();
  const contentType = request.headers.get("content-type") || "";

  let fields: Record<string, string>;
  let signatureValid = false;
  let providerPaymentId = "";
  let providerReference = "";
  let rawStatus = "";
  let amountMajor = "";
  let currency = "";

  if (contentType.includes("application/json")) {
    const header =
      request.headers.get("hitpay-signature") ||
      request.headers.get("x-hitpay-signature") ||
      request.headers.get("x-signature");
    signatureValid = verifyJsonWebhook(raw, header);
    try {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      fields = flatten(payload);
      const nestedPayment = firstPayment(payload.payments);
      // HitPay's current dashboard webhook contract places the payment
      // request id at payload.id and the actual payment/charge id at
      // payload.payments[0].id. Amount, currency, and status are taken from
      // that nested payment when available.
      providerPaymentId = stringValue(payload.id);
      providerReference = stringValue(nestedPayment?.id);
      rawStatus = stringValue(nestedPayment?.status) || stringValue(payload.status) || request.headers.get("hitpay-event-type") || "";
      amountMajor = stringValue(nestedPayment?.amount) || stringValue(payload.amount);
      currency = stringValue(nestedPayment?.currency) || stringValue(payload.currency);
    } catch {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
  } else {
    fields = Object.fromEntries(new URLSearchParams(raw));
    signatureValid = verifyFormWebhook(fields);
    providerPaymentId = fields.id || fields.payment_id || "";
    rawStatus = fields.status || "";
    amountMajor = fields.amount || "";
    currency = fields.currency || "";
  }

  if (!signatureValid) {
    console.error("[HitPay Webhook] signature verification failed");
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const reference = fields.reference_number || fields.reference || "";
  if (!reference) return NextResponse.json({ error: "missing_reference" }, { status: 400 });

  try {
    const result = await handleProviderUpdate({
      reference,
      providerPaymentId,
      providerReference,
      rawStatus,
      amountMajor,
      currency,
      signatureValid: true,
      source: "webhook",
      raw: fields,
    });
    // 200 for every verified callback (even amount_mismatch / unknown_payment)
    // so HitPay does not retry a callback we have already judged.
    return NextResponse.json({ received: true, outcome: result.outcome });
  } catch (error) {
    console.error("[HitPay Webhook] processing failed:", error);
    return NextResponse.json({ error: "processing_error" }, { status: 500 });
  }
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function firstPayment(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null;
  const first = value[0];
  return first && typeof first === "object" ? first as Record<string, unknown> : null;
}

function flatten(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    out[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return out;
}
