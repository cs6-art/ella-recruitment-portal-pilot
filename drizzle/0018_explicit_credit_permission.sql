-- Credit administration is an explicit capability. It is no longer inferred
-- from the display access role or from recruitment/settings permissions.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "can_manage_credits" boolean NOT NULL DEFAULT false;
