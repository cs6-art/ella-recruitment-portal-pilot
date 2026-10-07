import { desc, eq, sql } from "drizzle-orm";

import { getTenantDb as getDb } from "@/db/client";
import { creditAccounts, organizations, promoCodeRedemptions, promoCodes } from "@/db/schema";
import { appendAccountLedgerEntryOnExecutor } from "@/lib/ella-credits-accounts";
import {
  normalizePromoCode,
  PROMO_CODE_CREDITS,
  PROMO_CODE_LEDGER_EVENT,
  PROMO_CODE_LEDGER_NOTE,
  promoCodeAvailability,
  promoLedgerSourceEntryId,
  type PromoRedemptionFailure,
} from "@/lib/promo-code-rules";

export type PromoRedemptionResult =
  | { ok: true; credits: number; balanceAfter: number; code: string }
  | { ok: false; reason: PromoRedemptionFailure };

/**
 * Redeem a promo code for one organization's shared wallet.
 *
 * Everything happens in one transaction that first locks the code's row, so
 * concurrent attempts (double clicks, two HR users, retries) queue up and the
 * second one sees the first one's redemption. The unique (code, organization)
 * constraint and the deterministic ledger key are further backstops: credits
 * can be added at most once per code and organization.
 */
export async function redeemPromoCode(input: { code: string; organizationId: string; actorEmail: string; actorName: string }): Promise<PromoRedemptionResult> {
  const code = normalizePromoCode(input.code);
  const organizationId = input.organizationId.trim();
  if (!code || !organizationId) return { ok: false, reason: "invalid" };
  const db = getDb();
  return db.transaction(async (tx) => {
    const [promo] = await tx.select().from(promoCodes).where(eq(promoCodes.code, code)).for("update").limit(1);
    const availability = promoCodeAvailability(promo, organizationId);
    if (!availability.ok) return { ok: false as const, reason: availability.reason };

    const sourceEntryId = promoLedgerSourceEntryId(promo.id, organizationId);
    const [redemption] = await tx.insert(promoCodeRedemptions).values({
      promoCodeId: promo.id,
      organizationId,
      credits: promo.credits,
      redeemedByEmail: input.actorEmail.trim().toLowerCase(),
      redeemedByName: input.actorName.trim(),
      ledgerSourceEntryId: sourceEntryId,
    }).onConflictDoNothing().returning({ id: promoCodeRedemptions.id });
    if (!redemption) return { ok: false as const, reason: "already_redeemed" as const };

    await tx.update(promoCodes).set({ redemptionCount: sql`${promoCodes.redemptionCount} + 1`, updatedAt: new Date() }).where(eq(promoCodes.id, promo.id));
    // Organizations created before credits existed may not have a wallet yet.
    await tx.insert(creditAccounts).values({ organizationId, ownerEmail: "org", balance: 0 }).onConflictDoNothing({ target: creditAccounts.organizationId });
    const ledger = await appendAccountLedgerEntryOnExecutor(tx, {
      organizationId,
      ownerEmail: "org",
      entry: {
        type: "TopUp",
        event: PROMO_CODE_LEDGER_EVENT,
        units: promo.credits,
        creditsDelta: promo.credits,
        reference: promo.code,
        actorName: input.actorName,
        actorEmail: input.actorEmail,
        note: PROMO_CODE_LEDGER_NOTE,
        sourceEntryId,
      },
    }, { guard: false });
    return { ok: true as const, credits: promo.credits, balanceAfter: ledger.balanceAfter, code: promo.code };
  });
}

export type PromoCodeRow = {
  id: string;
  code: string;
  credits: number;
  organizationId: string | null;
  organizationName: string;
  maxRedemptions: number | null;
  redemptionCount: number;
  expiresAt: string | null;
  active: boolean;
  note: string;
  createdByEmail: string;
  createdAt: string;
  disabledAt: string | null;
};

const iso = (value: Date | null) => value ? value.toISOString() : null;

/** All codes, newest first (McLink credit managers only; enforced by the API). */
export async function listPromoCodes(): Promise<PromoCodeRow[]> {
  const rows = await getDb()
    .select({ promo: promoCodes, organizationName: organizations.name })
    .from(promoCodes)
    .leftJoin(organizations, eq(organizations.id, promoCodes.organizationId))
    .orderBy(desc(promoCodes.createdAt))
    .limit(200);
  return rows.map(({ promo, organizationName }) => ({
    id: promo.id,
    code: promo.code,
    credits: promo.credits,
    organizationId: promo.organizationId,
    organizationName: organizationName || "",
    maxRedemptions: promo.maxRedemptions,
    redemptionCount: promo.redemptionCount,
    expiresAt: iso(promo.expiresAt),
    active: promo.active,
    note: promo.note,
    createdByEmail: promo.createdByEmail,
    createdAt: promo.createdAt.toISOString(),
    disabledAt: iso(promo.disabledAt),
  }));
}

/** Who redeemed a code and when, for the management view. */
export async function listPromoCodeRedemptions(promoCodeId: string) {
  return getDb()
    .select({ organizationName: organizations.name, redeemedByEmail: promoCodeRedemptions.redeemedByEmail, redeemedByName: promoCodeRedemptions.redeemedByName, credits: promoCodeRedemptions.credits, redeemedAt: promoCodeRedemptions.redeemedAt })
    .from(promoCodeRedemptions)
    .innerJoin(organizations, eq(organizations.id, promoCodeRedemptions.organizationId))
    .where(eq(promoCodeRedemptions.promoCodeId, promoCodeId))
    .orderBy(desc(promoCodeRedemptions.redeemedAt))
    .limit(500);
}

/** Create a code worth exactly PROMO_CODE_CREDITS. Returns null when the code already exists. */
export async function createPromoCode(input: { code: string; organizationId?: string | null; maxRedemptions?: number | null; expiresAt?: Date | null; note?: string; actorEmail: string }) {
  const [created] = await getDb().insert(promoCodes).values({
    code: normalizePromoCode(input.code),
    credits: PROMO_CODE_CREDITS,
    organizationId: input.organizationId || null,
    maxRedemptions: input.maxRedemptions ?? null,
    expiresAt: input.expiresAt ?? null,
    note: (input.note || "").trim().slice(0, 300),
    createdByEmail: input.actorEmail.trim().toLowerCase(),
  }).onConflictDoNothing({ target: promoCodes.code }).returning({ id: promoCodes.id });
  return created ?? null;
}

/** Disable (or re-enable) a code. Past redemptions and their ledger rows are untouched. */
export async function setPromoCodeActive(input: { id: string; active: boolean; actorEmail: string }) {
  const [updated] = await getDb().update(promoCodes).set({
    active: input.active,
    disabledAt: input.active ? null : new Date(),
    disabledByEmail: input.active ? "" : input.actorEmail.trim().toLowerCase(),
    updatedAt: new Date(),
  }).where(eq(promoCodes.id, input.id)).returning({ id: promoCodes.id });
  return Boolean(updated);
}
