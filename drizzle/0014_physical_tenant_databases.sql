-- Physical database-per-tenant registry.
-- The organizations table stays in the McLink control-plane database. Each
-- non-default organization is routed to a separate Postgres URL configured by
-- TENANT_DATABASE_URLS, keyed by organization id. Connection secrets never
-- live in this control-plane table.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "database_key" text;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "database_status" text NOT NULL DEFAULT 'ready';

UPDATE "organizations"
SET "database_key" = CASE
  WHEN "id" = '00000000-0000-4000-8000-000000000001' THEN 'mclinkgroup'
  ELSE "slug"
END
WHERE "database_key" IS NULL OR "database_key" = '';

ALTER TABLE "organizations" ALTER COLUMN "database_key" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_database_key_uidx" ON "organizations" ("database_key");

UPDATE "organizations"
SET "database_status" = 'pending'
WHERE "id" <> '00000000-0000-4000-8000-000000000001'
  AND "database_status" = 'ready';
