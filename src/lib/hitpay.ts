import crypto from "node:crypto";

/**
 * HitPay payment gateway client (sandbox for the pilot).
 *
 * Env:
 *   HITPAY_API_KEY   — X-BUSINESS-API-KEY for the create/status calls (secret)
 *   HITPAY_SALT      — webhook HMAC salt (secret)
 *   HITPAY_MODE      — "sandbox" (default) | "live"
 *   HITPAY_API_URL   — optional explicit override of the API base URL
 *
 * The feature fails safe: when the key/salt are missing, `isHitpayConfigured()`
 * is false and the payment routes return 503 rather than half-working.
 *
 * Nothing here touches the credit ledger. A payment only grants credits after
 * `verifyWebhookSignature` passes AND the ledger grant (idempotent) succeeds —
 * see /api/webhooks/hitpay.
 */

const SANDBOX_BASE = "https://api.sandbox.hit-pay.com/v1";
const LIVE_BASE = "https://api.hit-pay.com/v1";

export function hitpayMode(): "sandbox" | "live" {
  return (process.env.HITPAY_MODE || "sandbox").trim().toLowerCase() === "live" ? "live" : "sandbox";
}

export function hitpayApiBase(): string {
  const explicit = process.env.HITPAY_API_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return hitpayMode() === "live" ? LIVE_BASE : SANDBOX_BASE;
}

function apiKey(): string {
  const key = process.env.HITPAY_API_KEY?.trim();
  if (!key) throw new Error("HITPAY_API_KEY is not configured.");
  return key;
}

function salt(): string {
  const value = process.env.HITPAY_SALT?.trim();
  if (!value) throw new Error("HITPAY_SALT is not configured.");
  return value;
}

export function isHitpayConfigured(): boolean {
  return Boolean(process.env.HITPAY_API_KEY?.trim() && process.env.HITPAY_SALT?.trim());
}

export type HitpayPaymentRequest = {
  id: string;
  url: string;
  status: string; // pending | completed | failed | expired
  amount: string;
  currency: string;
  referenceNumber: string;
};

type RawPaymentRequest = {
  id?: string;
  url?: string;
  status?: string;
  amount?: string | number;
  currency?: string;
  reference_number?: string;
  message?: string;
  error?: string;
  errors?: unknown;
};

function normalizeRequest(raw: RawPaymentRequest): HitpayPaymentRequest {
  return {
    id: String(raw.id ?? ""),
    url: String(raw.url ?? ""),
    status: String(raw.status ?? "pending").toLowerCase(),
    amount: String(raw.amount ?? ""),
    currency: String(raw.currency ?? "").toUpperCase(),
    referenceNumber: String(raw.reference_number ?? ""),
  };
}

/** Amount is decimal in the major unit; HitPay wants e.g. "50.00". */
function centsToAmount(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

export async function createPaymentRequest(input: {
  amountCents: number;
  currency: string;
  referenceNumber: string;
  email?: string;
  name?: string;
  purpose?: string;
  redirectUrl: string;
  webhookUrl: string;
}): Promise<HitpayPaymentRequest> {
  const body = new URLSearchParams({
    amount: centsToAmount(input.amountCents),
    currency: input.currency.toUpperCase(),
    reference_number: input.referenceNumber,
    redirect_url: input.redirectUrl,
    webhook: input.webhookUrl,
    purpose: input.purpose || "Ella Credits top-up",
    send_email: "false",
  });
  if (input.email) body.set("email", input.email);
  if (input.name) body.set("name", input.name);

  const response = await fetch(`${hitpayApiBase()}/payment-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-BUSINESS-API-KEY": apiKey(),
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
    cache: "no-store",
  });

  const data = (await response.json().catch(() => ({}))) as RawPaymentRequest;
  if (!response.ok || !data.id || !data.url) {
    const detail = data.message || data.error || (data.errors ? JSON.stringify(data.errors) : "") || `HTTP ${response.status}`;
    throw new Error(`HitPay create payment request failed: ${detail}`);
  }
  return normalizeRequest(data);
}

export async function getPaymentRequest(id: string): Promise<HitpayPaymentRequest & { payments: Array<Record<string, unknown>> }> {
  const response = await fetch(`${hitpayApiBase()}/payment-requests/${encodeURIComponent(id)}`, {
    headers: { "X-BUSINESS-API-KEY": apiKey(), "X-Requested-With": "XMLHttpRequest" },
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as RawPaymentRequest & { payments?: Array<Record<string, unknown>> };
  if (!response.ok || !data.id) {
    throw new Error(`HitPay get payment request failed: ${data.message || data.error || `HTTP ${response.status}`}`);
  }
  return { ...normalizeRequest(data), payments: Array.isArray(data.payments) ? data.payments : [] };
}

/**
 * Verify a HitPay webhook.
 *
 * Two formats are accepted:
 *  1. Classic form-encoded callback: every field except `hmac`, keys sorted
 *     ascending, concatenated `k1v1k2v2…`, HMAC-SHA256 with the salt (hex),
 *     compared to `hmac`.
 *  2. JSON "API" webhook: HMAC-SHA256 of the raw request body with the salt
 *     (hex), compared to the `hitpay-signature` / `x-hitpay-signature` header.
 *
 * Returns false on any mismatch or missing signature — the caller must 401.
 */
export function verifyFormWebhook(fields: Record<string, string>): boolean {
  const provided = fields.hmac;
  if (!provided) return false;
  const base = Object.keys(fields)
    .filter((key) => key !== "hmac")
    .sort()
    .map((key) => `${key}${fields[key]}`)
    .join("");
  const computed = crypto.createHmac("sha256", salt()).update(base).digest("hex");
  return timingSafeEqualHex(computed, provided);
}

export function verifyJsonWebhook(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const computed = crypto.createHmac("sha256", salt()).update(rawBody, "utf8").digest("hex");
  return timingSafeEqualHex(computed, signatureHeader.trim());
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Map HitPay's status vocabulary to ours. */
export function mapHitpayStatus(raw: string): "paid" | "pending" | "failed" | "expired" {
  const value = String(raw || "").toLowerCase();
  if (value === "completed" || value === "paid" || value === "succeeded") return "paid";
  if (value === "failed") return "failed";
  if (value === "expired") return "expired";
  return "pending";
}
