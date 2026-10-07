/**
 * Promo code rules shared by the redemption store, the API and the tests.
 * Kept free of imports so they can be unit tested directly.
 *
 * Every promo code grants exactly PROMO_CODE_CREDITS. The amount is fixed on
 * the server when a code is created; nothing the browser sends can change it.
 */

export const PROMO_CODE_CREDITS = 210;
export const PROMO_CODE_LEDGER_EVENT = "promo_code";
export const PROMO_CODE_LEDGER_LABEL = "Promotional Credits";
export const PROMO_CODE_LEDGER_NOTE = "Promo code redeemed";

/** Upper-case, no spaces; letters, digits and dashes only (4–40 characters). */
export const PROMO_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,38}[A-Z0-9]$/;

export function normalizePromoCode(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase().slice(0, 60);
}

export type PromoRedemptionFailure = "invalid" | "expired" | "used_up" | "already_redeemed";

export const PROMO_CODE_MESSAGES: Record<PromoRedemptionFailure | "success" | "unavailable" | "error", string> = {
  success: `Promo code applied. ${PROMO_CODE_CREDITS} credits have been added to your account.`,
  invalid: "This promo code is not valid.",
  expired: "This promo code has expired.",
  used_up: "This promo code has already been used.",
  already_redeemed: "Your organization has already redeemed this promotion.",
  unavailable: "Promo codes aren't available right now. Please contact support.",
  error: "The promo code could not be applied. Please try again.",
};

export type PromoCodeState = {
  active: boolean;
  organizationId: string | null;
  expiresAt: Date | string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
};

/**
 * Whether `organizationId` may redeem this code now. A code restricted to
 * another organization reads as "not valid", so a guessed code reveals nothing
 * about who it belongs to. The per-organization "already redeemed" check is
 * done separately, under the code's row lock.
 */
export function promoCodeAvailability(code: PromoCodeState | null | undefined, organizationId: string, now = new Date()): { ok: true } | { ok: false; reason: Exclude<PromoRedemptionFailure, "already_redeemed"> } {
  if (!code || !code.active) return { ok: false, reason: "invalid" };
  if (code.organizationId && code.organizationId !== organizationId) return { ok: false, reason: "invalid" };
  if (code.expiresAt) {
    const expires = code.expiresAt instanceof Date ? code.expiresAt.getTime() : Date.parse(code.expiresAt);
    if (Number.isFinite(expires) && expires <= now.getTime()) return { ok: false, reason: "expired" };
  }
  if (code.maxRedemptions !== null && code.redemptionCount >= code.maxRedemptions) return { ok: false, reason: "used_up" };
  return { ok: true };
}

/** One deterministic ledger key per code and organization: a replay can never add credits twice. */
export function promoLedgerSourceEntryId(promoCodeId: string, organizationId: string) {
  return `LDG-promo-${promoCodeId}-${organizationId}`;
}
