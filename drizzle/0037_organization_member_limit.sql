-- Optional cap on how many active people an organization may have.
-- NULL means no limit. Organizations created through self-service sign-up
-- start with a small limit that a McLink administrator can raise or remove.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "max_members" integer;

ALTER TABLE "organizations"
  DROP CONSTRAINT IF EXISTS "organizations_max_members_check";

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_max_members_check" CHECK ("max_members" IS NULL OR "max_members" >= 1);
