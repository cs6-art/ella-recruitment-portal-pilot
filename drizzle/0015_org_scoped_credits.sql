-- Ella Credits was keyed per (organization_id, owner_email) -- effectively a
-- separate wallet per HR user rather than one shared balance per
-- organization. That let one user's top-up be invisible to a colleague in the
-- same org doing a CV analysis or phone interview. Credits are an
-- organization-level resource: consolidate every organization's per-user
-- wallets into a single row and key the table on organization_id alone from
-- here on. Existing balances are summed, not discarded -- no credits are lost.
-- Per-actor attribution (who spent what) is unaffected: it already lives on
-- "credit_account_ledger.actor_email" / "actor_name", independent of which
-- row a ledger entry's account_id points at.

-- One canonical account per organization: the oldest row (stable choice, and
-- already holds the earliest ledger history).
CREATE TEMP TABLE "credit_account_canonical" AS
SELECT DISTINCT ON ("organization_id") "id" AS "keep_id", "organization_id"
FROM "credit_accounts"
ORDER BY "organization_id", "created_at" ASC, "id" ASC;

-- Fold every wallet's balance into the canonical row.
UPDATE "credit_accounts" "ca"
SET "balance" = "totals"."total_balance", "owner_email" = 'org', "updated_at" = now()
FROM (
  SELECT "organization_id", coalesce(sum("balance"), 0) AS "total_balance"
  FROM "credit_accounts"
  GROUP BY "organization_id"
) "totals"
JOIN "credit_account_canonical" "c" ON "c"."organization_id" = "totals"."organization_id"
WHERE "ca"."id" = "c"."keep_id";

-- Re-point every ledger entry from a now-duplicate wallet onto the canonical
-- one, so the full spend/top-up history stays visible after the duplicates
-- are dropped.
UPDATE "credit_account_ledger" "cal"
SET "account_id" = "c"."keep_id"
FROM "credit_accounts" "dup"
JOIN "credit_account_canonical" "c" ON "c"."organization_id" = "dup"."organization_id"
WHERE "cal"."account_id" = "dup"."id" AND "dup"."id" <> "c"."keep_id";

-- Drop the now-redundant per-user wallets.
DELETE FROM "credit_accounts" "ca"
USING "credit_account_canonical" "c"
WHERE "ca"."organization_id" = "c"."organization_id" AND "ca"."id" <> "c"."keep_id";

DROP TABLE "credit_account_canonical";

-- One balance per organization from now on. The original UNIQUE(organization_id, owner_email)
-- in migration 0010 was anonymous, so Postgres named it after its columns.
ALTER TABLE "credit_accounts" DROP CONSTRAINT IF EXISTS "credit_accounts_organization_id_owner_email_key";
DROP INDEX IF EXISTS "credit_accounts_owner_email_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "credit_accounts_organization_uidx" ON "credit_accounts" ("organization_id");
