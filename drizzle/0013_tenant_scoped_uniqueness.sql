-- Allow tenant-local identities and configuration to repeat safely.
-- Opaque public role/application identifiers remain globally unique so existing
-- links continue to resolve without adding an organization slug to every URL.

ALTER TABLE "departments" DROP CONSTRAINT IF EXISTS "departments_name_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "departments_organization_name_key_uidx"
  ON "departments" ("organization_id", "name_key");

ALTER TABLE "applicants" DROP CONSTRAINT IF EXISTS "applicants_primary_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "applicants_organization_primary_email_uidx"
  ON "applicants" ("organization_id", "primary_email");

ALTER TABLE "applicant_aliases" DROP CONSTRAINT IF EXISTS "applicant_aliases_kind_value_key";
CREATE UNIQUE INDEX IF NOT EXISTS "applicant_aliases_organization_kind_value_uidx"
  ON "applicant_aliases" ("organization_id", "kind", "value");

ALTER TABLE "portal_settings" DROP CONSTRAINT IF EXISTS "portal_settings_pkey";
ALTER TABLE "portal_settings"
  ADD CONSTRAINT "portal_settings_pkey" PRIMARY KEY ("organization_id", "key");
