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

const DEFAULT_PACKS: CreditPack[] = [
  { id: "starter", label: "Starter — 100 credits", credits: 100, amountCents: 5000, currency: "SGD" },
  { id: "standard", label: "Standard — 500 credits", credits: 500, amountCents: 22500, currency: "SGD" },
  { id: "bulk", label: "Bulk — 2000 credits", credits: 2000, amountCents: 80000, currency: "SGD" },
];

function isValidPack(value: unknown): value is CreditPack {
  if (!value || typeof value !== "object") return false;
  const pack = value as Record<string, unknown>;
  return (
    typeof pack.id === "string" && pack.id.trim().length > 0 &&
    typeof pack.credits === "number" && Number.isInteger(pack.credits) && pack.credits > 0 &&
    typeof pack.amountCents === "number" && Number.isInteger(pack.amountCents) && pack.amountCents > 0 &&
    typeof pack.currency === "string" && /^[A-Z]{3}$/.test(pack.currency)
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
        cached = parsed.map((pack: CreditPack) => ({ ...pack, label: pack.label || `${pack.credits} credits` }));
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
