-- Guided first-recruitment journey: organization-level progress.
--
-- Shape: {"steps": {"create_role": "<iso>", ...}, "completedAt": "<iso>",
--         "completionDismissedAt": "<iso>", "sampleRoles": {"<role uuid>": "<sample JD id>"}}
--
-- Steps are derived from real records (roles, applications, screening
-- results, HR decisions); this column only makes a completed step permanent
-- and stores the explicit "I reviewed this applicant" confirmation.
--
-- Backward compatible: existing rows get '{}', and the application reads and
-- writes this column with raw SQL behind a try/catch, so deploying the code
-- before this migration only means progress is derived, not stored.
--
-- Rollback: ALTER TABLE "organizations" DROP COLUMN IF EXISTS "onboarding_progress";

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "onboarding_progress" jsonb NOT NULL DEFAULT '{}'::jsonb;
