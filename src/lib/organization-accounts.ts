import { eq, and } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db/client";
import { creditAccounts, organizationMemberships, organizations } from "@/db/schema";

/** Stable tenant for the existing Pilot data set. */
export const DEFAULT_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function findActiveOrganizationMembership(email: string) {
  if (!isDatabaseConfigured()) return null;
  const db = getDb();
  try {
    const [membership] = await db
      .select({ organizationId: organizationMemberships.organizationId, organizationActive: organizations.active })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(and(eq(organizationMemberships.email, normalizedEmail(email)), eq(organizationMemberships.active, true), eq(organizations.active, true)))
      .limit(1);
    return membership ?? null;
  } catch (error) {
    // The membership table is introduced by the opt-in migration. Login must
    // retain the legacy behaviour until that migration is deliberately run.
    console.error("[Organizations] Membership lookup unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Keep the database tenant directory in sync with the existing HR account
 * directory. This is intentionally scoped to the operator's current tenant;
 * it cannot grant access to another organization.
 */
export async function syncOrganizationMembership(input: {
  organizationId: string;
  email: string;
  active: boolean;
  previousEmail?: string;
}) {
  if (!isDatabaseConfigured()) return;
  const organizationId = input.organizationId.trim();
  const email = normalizedEmail(input.email);
  const previousEmail = input.previousEmail ? normalizedEmail(input.previousEmail) : "";
  if (!organizationId || !email) return;

  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      if (previousEmail && previousEmail !== email) {
        await tx
          .update(organizationMemberships)
          .set({ active: false, updatedAt: new Date() })
          .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.email, previousEmail)));
      }
      await tx
        .insert(organizationMemberships)
        .values({ organizationId, email, active: input.active })
        .onConflictDoUpdate({
          target: [organizationMemberships.organizationId, organizationMemberships.email],
          set: { active: input.active, updatedAt: new Date() },
        });
      await tx
        .insert(creditAccounts)
        .values({ organizationId, ownerEmail: email, balance: 0 })
        .onConflictDoNothing({ target: [creditAccounts.organizationId, creditAccounts.ownerEmail] });
    });
  } catch (error) {
    // The migration is deliberately opt-in. Legacy deployments can continue
    // using the existing directory until their tenant tables are provisioned.
    console.error("[Organizations] Membership sync unavailable:", error instanceof Error ? error.message : error);
  }
}

export async function resolveOrganizationForLogin(email: string, allowedDomain: string) {
  const membership = await findActiveOrganizationMembership(email);
  if (membership) return membership.organizationId;
  const domain = normalizedEmail(email).split("@")[1] || "";
  return domain === normalizedEmail(allowedDomain) ? DEFAULT_ORGANIZATION_ID : null;
}

export function isDefaultOrganization(organizationId: string | undefined) {
  return organizationId?.trim() === DEFAULT_ORGANIZATION_ID;
}
