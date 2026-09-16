-- Restore the intended one-wallet-per-organization credit model.
-- Migration 0017 temporarily introduced per-user wallets and provisioned new
-- zero-balance rows, which made existing org credits appear to disappear.
-- Consolidate every wallet without changing the total balance or deleting
-- ledger history. Actor attribution remains on each ledger row.

DROP INDEX IF EXISTS "credit_accounts_organization_owner_uidx";

CREATE TEMP TABLE "credit_account_canonical_0019" AS
SELECT DISTINCT ON ("organization_id")
  "id" AS "keep_id",
  "organization_id"
FROM "credit_accounts"
ORDER BY "organization_id", "created_at" ASC, "id" ASC;

UPDATE "credit_accounts" "ca"
SET "balance" = "totals"."total_balance",
    "owner_email" = 'org',
    "updated_at" = now()
FROM (
  SELECT "organization_id", coalesce(sum("balance"), 0)::int AS "total_balance"
  FROM "credit_accounts"
  GROUP BY "organization_id"
) "totals"
JOIN "credit_account_canonical_0019" "c"
  ON "c"."organization_id" = "totals"."organization_id"
WHERE "ca"."id" = "c"."keep_id";

UPDATE "credit_account_ledger" "cal"
SET "account_id" = "c"."keep_id"
FROM "credit_accounts" "duplicate"
JOIN "credit_account_canonical_0019" "c"
  ON "c"."organization_id" = "duplicate"."organization_id"
WHERE "cal"."account_id" = "duplicate"."id"
  AND "duplicate"."id" <> "c"."keep_id";

DELETE FROM "credit_accounts" "duplicate"
USING "credit_account_canonical_0019" "c"
WHERE "duplicate"."organization_id" = "c"."organization_id"
  AND "duplicate"."id" <> "c"."keep_id";

DROP TABLE "credit_account_canonical_0019";

ALTER TABLE "credit_accounts"
  DROP CONSTRAINT IF EXISTS "credit_accounts_organization_id_owner_email_key";
DROP INDEX IF EXISTS "credit_accounts_owner_email_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "credit_accounts_organization_uidx"
  ON "credit_accounts" ("organization_id");
