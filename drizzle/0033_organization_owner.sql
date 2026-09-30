-- The first person to register into an organization is its owner. Owners manage
-- the organization's team (deactivate, reactivate); other HR accounts keep full
-- recruitment access. Deactivations are stamped for the audit trail.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_organization_owner" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deactivated_at" timestamptz;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deactivated_by" text NOT NULL DEFAULT '';

-- At most one owner per organization.
CREATE UNIQUE INDEX IF NOT EXISTS "users_one_owner_per_org_uidx" ON "users" ("organization_id") WHERE "is_organization_owner";

-- Existing client organizations: the earliest account becomes the owner.
-- McLink's own organization is run by platform administrators and is skipped.
UPDATE "users" SET "is_organization_owner" = true
WHERE "id" IN (
  SELECT DISTINCT ON ("organization_id") "id"
  FROM "users"
  WHERE "organization_id" <> '00000000-0000-4000-8000-000000000001'
  ORDER BY "organization_id", "created_at" ASC, "id" ASC
)
AND NOT EXISTS (
  SELECT 1 FROM "users" existing
  WHERE existing."organization_id" = "users"."organization_id" AND existing."is_organization_owner"
);
