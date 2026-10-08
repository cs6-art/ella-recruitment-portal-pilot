// Relative imports (not "@/...") so the concurrency check and tests can load
// this module directly under plain Node.
import { and, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

import { launchPromotionAllocations, launchPromotions } from "../db/schema.ts";

/** Stable identifier of the event launch promotion row seeded by migration 0041. */
export const LAUNCH_PROMOTION_KEY = "event-launch-first-100";

/** What a client sees in their credit history for the launch grant. */
export const LAUNCH_WELCOME_CREDIT_EVENT = "launch_welcome_credit";
export const LAUNCH_WELCOME_CREDIT_NOTE = "Event Welcome Credits";

// Any drizzle Postgres database or transaction (Neon in production, node-postgres in checks).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Executor = PgDatabase<any, any, any>;

export type LaunchPromotionClaim = { promotionId: string; name: string; credits: number; sequenceNumber: number };

/** Postgres "undefined_table": migration 0041 has not been applied to this database yet. */
function isMissingTable(error: unknown) {
  // drizzle wraps driver errors; the Postgres code lives on the wrapped cause.
  for (let current: unknown = error, depth = 0; current && typeof current === "object" && depth < 4; current = (current as { cause?: unknown }).cause, depth += 1) {
    if ((current as { code?: string }).code === "42P01") return true;
  }
  return false;
}

/**
 * Claim one promotion slot for a brand-new organization. Call it inside the
 * organization-creation transaction.
 *
 * Concurrency: the slot is taken by ONE conditional UPDATE. Concurrent claims
 * queue on that row's lock, and each re-evaluates `allocated_count < max`
 * after the previous one commits, so at most `max_allocations` claims can ever
 * succeed — there is no separate count-then-insert step to race. The table's
 * CHECK constraint is a second backstop. The counter and the allocation row
 * live in the caller's transaction: if organization creation fails, the slot
 * is returned automatically.
 *
 * Returns null when the promotion is inactive, not yet started, exhausted, or
 * not installed — the caller then grants the normal welcome credits.
 */
export async function claimLaunchPromotion(tx: Executor, organizationId: string): Promise<LaunchPromotionClaim | null> {
  try {
    // A nested transaction is a SAVEPOINT, so a missing table cannot poison the outer transaction.
    return await tx.transaction(async (inner) => {
      const [claimed] = await inner
        .update(launchPromotions)
        .set({ allocatedCount: sql`${launchPromotions.allocatedCount} + 1`, updatedAt: new Date() })
        .where(and(
          eq(launchPromotions.key, LAUNCH_PROMOTION_KEY),
          eq(launchPromotions.active, true),
          sql`${launchPromotions.startsAt} IS NOT NULL AND ${launchPromotions.startsAt} <= now()`,
          sql`${launchPromotions.allocatedCount} < ${launchPromotions.maxAllocations}`,
        ))
        .returning({ id: launchPromotions.id, name: launchPromotions.name, credits: launchPromotions.credits, sequenceNumber: launchPromotions.allocatedCount });
      if (!claimed) return null;
      const ledgerSourceEntryId = `LDG-launch-welcome-${organizationId}`;
      await inner.insert(launchPromotionAllocations).values({
        promotionId: claimed.id,
        organizationId,
        sequenceNumber: claimed.sequenceNumber,
        credits: claimed.credits,
        ledgerSourceEntryId,
      });
      return { promotionId: claimed.id, name: claimed.name, credits: claimed.credits, sequenceNumber: claimed.sequenceNumber };
    });
  } catch (error) {
    if (isMissingTable(error)) {
      console.error("[Launch Promotion] Tables are missing (apply migration 0041); granting the normal welcome credits.");
      return null;
    }
    throw error;
  }
}

export type LaunchPromotionStatus = {
  name: string;
  credits: number;
  maxAllocations: number;
  allocatedCount: number;
  remaining: number;
  active: boolean;
  startsAt: string | null;
};

export type LaunchPromotionAllocation = { organizationId: string; sequenceNumber: number; credits: number; allocatedAt: string };

export async function getLaunchPromotionStatus(db: Executor): Promise<LaunchPromotionStatus | null> {
  const [row] = await db.select().from(launchPromotions).where(eq(launchPromotions.key, LAUNCH_PROMOTION_KEY)).limit(1);
  if (!row) return null;
  return {
    name: row.name,
    credits: row.credits,
    maxAllocations: row.maxAllocations,
    allocatedCount: row.allocatedCount,
    remaining: Math.max(0, row.maxAllocations - row.allocatedCount),
    active: row.active,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
  };
}

export async function listLaunchPromotionAllocations(db: Executor, limit = 200): Promise<LaunchPromotionAllocation[]> {
  const rows = await db
    .select({ organizationId: launchPromotionAllocations.organizationId, sequenceNumber: launchPromotionAllocations.sequenceNumber, credits: launchPromotionAllocations.credits, allocatedAt: launchPromotionAllocations.allocatedAt })
    .from(launchPromotionAllocations)
    .innerJoin(launchPromotions, eq(launchPromotions.id, launchPromotionAllocations.promotionId))
    .where(eq(launchPromotions.key, LAUNCH_PROMOTION_KEY))
    .orderBy(desc(launchPromotionAllocations.sequenceNumber))
    .limit(limit);
  return rows.map((row) => ({ ...row, allocatedAt: row.allocatedAt.toISOString() }));
}

/**
 * Switch the promotion on or off. The first activation stamps `starts_at`, so
 * only organizations created from that moment on can ever receive it; pausing
 * and resuming keeps the original start. Never changes a balance.
 */
export async function setLaunchPromotionActive(db: Executor, active: boolean): Promise<LaunchPromotionStatus | null> {
  await db
    .update(launchPromotions)
    .set({ active, startsAt: active ? sql`COALESCE(${launchPromotions.startsAt}, now())` : launchPromotions.startsAt, updatedAt: new Date() })
    .where(eq(launchPromotions.key, LAUNCH_PROMOTION_KEY));
  return getLaunchPromotionStatus(db);
}
