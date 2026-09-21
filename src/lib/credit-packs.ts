/**
 * Purchasable Ella Credit packs.
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

/** Ella Credits are priced at S$0.40 per credit. Keep this calculation in one
 * server-only module so a client payload or an env override cannot change the
 * amount charged for a given quantity. */
export const ELLA_CREDIT_PRICE_CENTS = 40;

export function amountCentsForCredits(credits: number): number {
  const quantity = Math.trunc(credits);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Credit quantity must be a positive whole number.");
  return quantity * ELLA_CREDIT_PRICE_CENTS;
}

const DEFAULT_PACKS: CreditPack[] = [
  { id: "starter", label: "Starter — 10 credits", credits: 10, amountCents: 400, currency: "SGD" },
  { id: "standard", label: "Standard — 50 credits", credits: 50, amountCents: 2000, currency: "SGD" },
  { id: "bulk", label: "Bulk — 100 credits", credits: 100, amountCents: 4000, currency: "SGD" },
];

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
  cached = DEFAULT_PACKS;
  return cached;
}

export function findCreditPack(packId: string): CreditPack | undefined {
  const normalized = String(packId || "").trim().toLowerCase();
  return creditPacks().find((pack) => pack.id.toLowerCase() === normalized);
}

/** Test-only: drop the memoized catalog so an env change takes effect. */
export function resetCreditPackCache(): void {
  cached = null;
}
