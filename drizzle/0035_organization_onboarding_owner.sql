-- Mark organizations created through the guided onboarding flow. Existing
-- organizations stay outside the new checklist. The organization owner is
-- assigned automatically to the first verified registrant, so nothing else
-- needs to be recorded here.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "onboarding_started_at" timestamptz;
