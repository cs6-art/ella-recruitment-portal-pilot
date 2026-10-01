import { creditAccountLedger, creditAccounts } from "@/db/schema";
import type { getDb } from "@/db/client";
import { welcomeCredits } from "@/lib/welcome-credit-config";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Create the organization's credit account holding the welcome grant and
 * its ledger entry. The account is the organization's single shared wallet
 * (one row per organization_id), so the free credits are spendable by every
 * member of that organization and by no other organization. Run inside the
 * organization-creation transaction so the org never exists without its grant. Idempotent: an account that already exists is
 * left untouched, so this can never top an org up twice.
 */
export async function grantWelcomeCredits(tx: Tx, organizationId: string): Promise<number> {
  const credits = welcomeCredits();
  if (credits <= 0) return 0;
  const [account] = await tx
    .insert(creditAccounts)
    .values({ organizationId, ownerEmail: "org", balance: credits })
    .onConflictDoNothing({ target: creditAccounts.organizationId })
    .returning({ id: creditAccounts.id });
  if (!account) return 0;
  await tx.insert(creditAccountLedger).values({
    accountId: account.id,
    type: "TopUp",
    event: "welcome_credit",
    units: credits,
    creditsDelta: credits,
    balanceAfter: credits,
    actorName: "Smile",
    note: "Welcome credits for a new organization",
    sourceEntryId: `LDG-welcome-${organizationId}`,
  });
  return credits;
}
