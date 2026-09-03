/**
 * Small payment invariants kept separate from the database orchestration so
 * they can be tested without importing the Google/Neon adapters.
 */

/**
 * Parse a provider major-unit amount with exactly the precision supported by
 * SGD. Exponents, signs, whitespace, extra decimal places, and non-numbers
 * are rejected instead of being coerced by Number().
 */
export function parseProviderAmountCents(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null;

  const [wholePart, fractionPart = ""] = value.split(".");
  const whole = Number(wholePart);
  const cents = whole * 100 + Number((fractionPart + "00").slice(0, 2));
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(cents) || cents <= 0) return null;
  return cents;
}

/**
 * Only a unique violation on payment_events.dedupe_key is a replay. Other
 * database errors must bubble up so the provider can retry the webhook.
 */
export function isPaymentEventDedupeConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === "23505" && typeof candidate.constraint === "string" && candidate.constraint.toLowerCase().includes("dedupe_key");
}
