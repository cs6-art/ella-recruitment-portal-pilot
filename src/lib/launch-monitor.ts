import { and, desc, eq, gte, ne, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { creditAccounts, launchPromotionAllocations, launchPromotions, organizations } from "@/db/schema";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organization-accounts";
import { getLaunchPromotionStatus, LAUNCH_PROMOTION_KEY, type LaunchPromotionStatus } from "@/lib/launch-promotion";

export type LaunchMonitorOrganization = {
  name: string;
  createdAt: string;
  active: boolean;
  /** Welcome credits this organization received from the launch promotion; null when it did not receive them. */
  promotionCredits: number | null;
  promotionNumber: number | null;
  balance: number;
};

export type LaunchMonitorSnapshot = {
  promotion: LaunchPromotionStatus | null;
  /** Client organizations (McLink itself excluded) created in total. */
  organizationsCreated: number;
  /** Client organizations created since the promotion started. */
  organizationsSincePromotionStart: number;
  organizations: LaunchMonitorOrganization[];
};

/** Platform administrators only: callers must verify before using this. */
export async function getLaunchMonitorSnapshot(limit = 300): Promise<LaunchMonitorSnapshot> {
  const db = getDb();
  const promotion = await getLaunchPromotionStatus(db);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(organizations).where(ne(organizations.id, DEFAULT_ORGANIZATION_ID));
  let since = 0;
  if (promotion?.startsAt) {
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(organizations)
      .where(and(ne(organizations.id, DEFAULT_ORGANIZATION_ID), gte(organizations.createdAt, new Date(promotion.startsAt))));
    since = row.total;
  }

  const rows = await db
    .select({
      name: organizations.name,
      createdAt: organizations.createdAt,
      active: organizations.active,
      balance: creditAccounts.balance,
      promotionCredits: launchPromotionAllocations.credits,
      promotionNumber: launchPromotionAllocations.sequenceNumber,
    })
    .from(organizations)
    .leftJoin(creditAccounts, eq(creditAccounts.organizationId, organizations.id))
    .leftJoin(launchPromotions, eq(launchPromotions.key, LAUNCH_PROMOTION_KEY))
    .leftJoin(launchPromotionAllocations, and(eq(launchPromotionAllocations.organizationId, organizations.id), eq(launchPromotionAllocations.promotionId, launchPromotions.id)))
    .where(ne(organizations.id, DEFAULT_ORGANIZATION_ID))
    .orderBy(desc(organizations.createdAt))
    .limit(Math.max(1, Math.min(limit, 1000)));

  return {
    promotion,
    organizationsCreated: total,
    organizationsSincePromotionStart: since,
    organizations: rows.map((row) => ({
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      active: row.active,
      promotionCredits: row.promotionCredits ?? null,
      promotionNumber: row.promotionNumber ?? null,
      balance: row.balance ?? 0,
    })),
  };
}
