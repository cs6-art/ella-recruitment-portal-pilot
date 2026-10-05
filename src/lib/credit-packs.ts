/**
 * Purchasable Smile Credit packs.
 *
 * Pricing is ALWAYS server-side. The client sends only a `packId`; the server
 * looks up the credits and the payable amount here. There is no code path that
 * accepts a client-supplied price or credit amount.
 *
 * The default catalog below can be overridden by a JSON array in the
 * `ELLA_CREDIT_PACKS` env var (or a future Settings key) — same shape — so the
 * operator can retune packs without a deploy. A malformed override is ignored
 * and logged; the built-in catalog is the floor.
 */

export type CreditPack = {
  id: string;
  label: string;
  credits: number;
  /** Payable amount in the smallest currency unit (cents). */
  amountCents: number;
  currency: string;
};

/** Smile Credits are priced at S$0.40 per credit unless the operator sets
 * `ELLA_CREDIT_PRICE_CENTS` (a whole number of cents, e.g. 50 while HitPay's
 * minimum charge is S$0.50). It is a server-side env var, so a client payload
 * cannot change the amount charged for a given quantity. */
export const DEFAULT_CREDIT_PRICE_CENTS = 40;

export function creditPriceCents(): number {
  const raw = process.env.ELLA_CREDIT_PRICE_CENTS?.trim();
  if (!raw) return DEFAULT_CREDIT_PRICE_CENTS;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_CREDIT_PRICE_CENTS;
}

/** Currencies a buyer can pay in. HitPay offers methods by currency: PayNow for SGD, QR Ph for PHP. */
export type PaymentCurrency = "SGD" | "PHP";

/** Per-credit price in centavos for PHP checkouts (e.g. 1800 = ₱18.00). PHP is offered only when this is set,
 * so the exchange rate is always an explicit operator decision made server-side. */
export function creditPricePhpCentavos(): number | null {
  const raw = process.env.ELLA_CREDIT_PRICE_PHP_CENTS?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function enabledCurrencies(): PaymentCurrency[] {
  return creditPricePhpCentavos() === null ? ["SGD"] : ["SGD", "PHP"];
}

export function parsePaymentCurrency(value: unknown): PaymentCurrency | null {
  const code = String(value ?? "").trim().toUpperCase();
  return (enabledCurrencies() as string[]).includes(code) ? (code as PaymentCurrency) : null;
}

export function creditPriceFor(currency: PaymentCurrency): number {
  return currency === "PHP" ? (creditPricePhpCentavos() ?? creditPriceCents()) : creditPriceCents();
}

export function amountCentsForCredits(credits: number, currency: PaymentCurrency = "SGD"): number {
  const quantity = Math.trunc(credits);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Credit quantity must be a positive whole number.");
  return quantity * creditPriceFor(currency);
}

/** Custom purchases: any whole number of credits in this range, at the fixed rate. */
export const MIN_CUSTOM_CREDITS = 1;
export const MAX_CUSTOM_CREDITS = 10000;

/** Build a one-off pack for a custom quantity, or null if it is out of range. */
export function customCreditPack(credits: unknown, currency: PaymentCurrency = "SGD"): CreditPack | null {
  if (typeof credits !== "number" || !Number.isInteger(credits)) return null;
  if (credits < MIN_CUSTOM_CREDITS || credits > MAX_CUSTOM_CREDITS) return null;
  return { id: "custom", label: `Custom — ${credits} credits`, credits, amountCents: amountCentsForCredits(credits, currency), currency };
}

// Amounts are derived from the per-credit price so the packs follow `ELLA_CREDIT_PRICE_CENTS`.
// 2,000 credits reaches the volume-discount threshold, so the server adds a 10% bonus (see volumeDiscountBonus).
function defaultPacks(): CreditPack[] {
  return [
    { id: "starter", label: "Starter — 50 credits", credits: 50 },
    { id: "standard", label: "Standard — 100 credits", credits: 100 },
    { id: "bulk", label: "Bulk — 2,000 credits", credits: 2000 },
  ].map((pack) => ({ ...pack, amountCents: amountCentsForCredits(pack.credits), currency: "SGD" }));
}

function isValidPack(value: unknown): value is Pick<CreditPack, "id" | "label" | "credits"> {
  if (!value || typeof value !== "object") return false;
  const pack = value as Record<string, unknown>;
  return (
    typeof pack.id === "string" && pack.id.trim().length > 0 &&
    typeof pack.credits === "number" && Number.isInteger(pack.credits) && pack.credits > 0 &&
    (pack.label === undefined || typeof pack.label === "string")
  );
}

let cached: CreditPack[] | null = null;

export function creditPacks(): CreditPack[] {
  if (cached) return cached;
  const override = process.env.ELLA_CREDIT_PACKS?.trim();
  if (override) {
    try {
      const parsed = JSON.parse(override);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isValidPack)) {
        cached = parsed.map((pack) => ({
          id: pack.id.trim().toLowerCase(),
          label: pack.label?.trim() || `${pack.credits} credits`,
          credits: pack.credits,
          amountCents: amountCentsForCredits(pack.credits),
          currency: "SGD",
        }));
        return cached;
      }
      console.error("[Credit Packs] ELLA_CREDIT_PACKS is not a valid pack array — using the built-in catalog.");
    } catch (error) {
      console.error("[Credit Packs] ELLA_CREDIT_PACKS is not valid JSON — using the built-in catalog:", error);
    }
  }
  cached = defaultPacks();
  return cached;
}

/** The catalog priced in another currency; credits per pack stay the same. */
export function creditPacksIn(currency: PaymentCurrency): CreditPack[] {
  return creditPacks().map((pack) => (pack.currency === currency ? pack : { ...pack, amountCents: amountCentsForCredits(pack.credits, currency), currency }));
}

export function findCreditPack(packId: string, currency: PaymentCurrency = "SGD"): CreditPack | undefined {
  const normalized = String(packId || "").trim().toLowerCase();
  return creditPacksIn(currency).find((pack) => pack.id.toLowerCase() === normalized);
}

/** Test-only: drop the memoized catalog so an env change takes effect. */
export function resetCreditPackCache(): void {
  cached = null;
}
