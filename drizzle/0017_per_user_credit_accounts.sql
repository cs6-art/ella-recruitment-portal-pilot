-- Restore per-user credit wallets inside each tenant.
-- Migration 0015 intentionally consolidated wallets to one row per
-- organization. The portal now meters AI usage per signed-in account, while
-- retaining organization_id on every wallet to preserve tenant isolation.

DROP INDEX IF EXISTS "credit_accounts_organization_uidx";
CREATE UNIQUE INDEX IF NOT EXISTS "credit_accounts_organization_owner_uidx"
  ON "credit_accounts" ("organization_id", "owner_email");

-- Keep the old consolidated wallet as the organization/system wallet. New
-- account wallets are provisioned at login with a zero balance, so an HR user
-- cannot inherit McLink's shared balance.
