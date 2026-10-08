-- Per-organization retention for Live Avatar interview recordings.
--
-- NULL keeps the platform default (INTERVIEW_RECORDING_RETENTION_DAYS, 90 when
-- unset). A value must be 7 to 365 days. Existing organizations start on the
-- platform default, so nothing changes until an administrator sets a period.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "interview_recording_retention_days" integer;

ALTER TABLE "organizations" ADD CONSTRAINT "organizations_recording_retention_range"
  CHECK ("interview_recording_retention_days" IS NULL OR "interview_recording_retention_days" BETWEEN 7 AND 365);
