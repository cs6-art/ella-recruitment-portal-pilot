-- Role IDs are readable tenant-local identifiers. Existing role IDs remain
-- unchanged, but a second organization may now use the same SQTE01/CSE01
-- sequence without colliding with another tenant's rows.
ALTER TABLE "roles" DROP CONSTRAINT IF EXISTS "roles_external_id_key";
ALTER TABLE "roles" DROP CONSTRAINT IF EXISTS "roles_code_key";

CREATE UNIQUE INDEX IF NOT EXISTS "roles_organization_external_id_uidx"
  ON "roles" ("organization_id", "external_id");
CREATE UNIQUE INDEX IF NOT EXISTS "roles_organization_code_uidx"
  ON "roles" ("organization_id", "code");
