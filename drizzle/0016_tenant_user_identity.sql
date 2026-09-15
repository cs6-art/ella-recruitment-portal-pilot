-- User emails identify a person inside an organization, not a globally unique
-- portal account. The same Google identity may be invited into more than one
-- organization; the session/login flow must still select exactly one tenant.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "users_organization_email_uidx"
  ON "users" ("organization_id", "email");
