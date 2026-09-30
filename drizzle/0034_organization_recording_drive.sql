-- Give each organization its own connected Google Drive account and folder
-- for future Live Avatar recordings. Existing OAuth links stay organization-
-- scoped in oauth_connections; existing recording rows remain untouched.

-- Earlier schemas accidentally limited OAuth providers to one row per email
-- across every organization. Drop that legacy key so one Google account can
-- independently authorize recording storage in multiple organizations.
ALTER TABLE "oauth_connections"
  DROP CONSTRAINT IF EXISTS "oauth_connections_user_email_provider_key";

-- Recording storage uses its own narrowly scoped OAuth provider identifier.
ALTER TABLE "oauth_connections"
  DROP CONSTRAINT IF EXISTS "oauth_connections_provider_check";
ALTER TABLE "oauth_connections"
  ADD CONSTRAINT "oauth_connections_provider_check"
  CHECK ("provider" IN ('google_calendar', 'google_drive', 'google_drive_recordings', 'microsoft_drive'));

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_connections_org_provider_email_uidx"
  ON "oauth_connections" ("organization_id", "provider", "user_email");

CREATE TABLE IF NOT EXISTS "organization_recording_drive" (
  "organization_id" uuid PRIMARY KEY REFERENCES "organizations" ("id"),
  "google_account_email" text NOT NULL DEFAULT '',
  "folder_id" text NOT NULL DEFAULT '',
  "folder_name" text NOT NULL DEFAULT '',
  "connected_by_email" text NOT NULL DEFAULT '',
  "updated_by_email" text NOT NULL DEFAULT '',
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "live_interview_sessions"
  ADD COLUMN IF NOT EXISTS "recording_storage_account_email" text NOT NULL DEFAULT '';
