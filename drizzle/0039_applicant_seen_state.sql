-- Per-user "new applicant" read state for the header bell, the sidebar badge
-- and the NEW highlight on the Applicants list. Previously this was a single
-- per-browser timestamp, so opening one new applicant cleared all of them and
-- the state never followed a user to another device.
--
-- applicant_seen: one row per user and application they have opened.
-- Rows go away with the application (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS "applicant_seen" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "user_email" text NOT NULL,
  "application_id" uuid NOT NULL REFERENCES "applications"("id") ON DELETE CASCADE,
  "seen_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "applicant_seen_pkey" PRIMARY KEY ("organization_id", "user_email", "application_id")
);

CREATE INDEX IF NOT EXISTS "applicant_seen_application_idx"
  ON "applicant_seen" ("application_id");

-- user_notification_state: when the user last pressed "Mark all as read"
-- (or first used the bell). Applications that arrived before it are not new.
CREATE TABLE IF NOT EXISTS "user_notification_state" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "user_email" text NOT NULL,
  "applicants_cleared_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_notification_state_pkey" PRIMARY KEY ("organization_id", "user_email")
);
