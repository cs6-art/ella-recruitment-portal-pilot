-- Preserve the tenant that owns each paid credit purchase so webhook and
-- reconciliation grants use the same organization-scoped wallet.

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "organization_id" uuid;

UPDATE "payments"
SET "organization_id" = '00000000-0000-4000-8000-000000000001'
WHERE "organization_id" IS NULL;

ALTER TABLE "payments" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");

CREATE INDEX IF NOT EXISTS "payments_organization_id_idx" ON "payments" ("organization_id");
