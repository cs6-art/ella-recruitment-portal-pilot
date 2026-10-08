import { eq } from "drizzle-orm";

// Relative imports (not "@/...") so the launch-promotion checks can load this
// module directly under plain Node.
import { creditAccountLedger, creditAccounts } from "../db/schema.ts";
import type { getDb } from "../db/client.ts";
import { claimLaunchPromotion, LAUNCH_WELCOME_CREDIT_EVENT, LAUNCH_WELCOME_CREDIT_NOTE } from "./launch-promotion.ts";
import { welcomeCredits } from "./welcome-credit-config.ts";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Create the organization's credit account holding the welcome grant and
 * its ledger entry. The account is the organization's single shared wallet
 * (one row per organization_id), so the free credits are spendable by every
 * member of that organization and by no other organization. Run inside the
 * organization-creation transaction so the org never exists without its grant.
 *
 * Which grant: one of the first N organizations created while the event
 * launch promotion is active receives the promotion's credits (250) as an
 * "Event Welcome Credits" ledger entry instead of the normal default; every
 * other new organization receives the normal welcome credits (`welcomeCredits()`),
 * exactly as before. Either way the organization gets ONE grant, never both.
 *
 * Idempotent: an organization that already has an account is left untouched
 * (and never claims a promotion slot), so this can never top an org up twice.
 */
export async function grantWelcomeCredits(tx: Tx, organizationId: string): Promise<number> {
  const [existing] = await tx.select({ id: creditAccounts.id }).from(creditAccounts).where(eq(creditAccounts.organizationId, organizationId)).limit(1);
  if (existing) return 0;

  const promotion = await claimLaunchPromotion(tx, organizationId);
  const credits = promotion ? promotion.credits : welcomeCredits();
  if (credits <= 0) return 0;

  const [account] = await tx
    .insert(creditAccounts)
    .values({ organizationId, ownerEmail: "org", balance: credits })
    .onConflictDoNothing({ target: creditAccounts.organizationId })
    .returning({ id: creditAccounts.id });
  if (!account) {
    // Lost a race for the same organization's account: give back the slot we took.
    if (promotion) throw new Error("The organization's credit account already exists; rolling back its promotion slot.");
    return 0;
  }
  await tx.insert(creditAccountLedger).values({
    accountId: account.id,
    type: "TopUp",
    event: promotion ? LAUNCH_WELCOME_CREDIT_EVENT : "welcome_credit",
    units: credits,
    creditsDelta: credits,
    balanceAfter: credits,
    actorName: "Smile",
    note: promotion ? LAUNCH_WELCOME_CREDIT_NOTE : "Welcome credits for a new organization",
    sourceEntryId: promotion ? `LDG-launch-welcome-${organizationId}` : `LDG-welcome-${organizationId}`,
  });
  return credits;
}
