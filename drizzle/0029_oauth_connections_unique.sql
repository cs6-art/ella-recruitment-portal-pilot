-- oauth_connections becomes the store for the per-user Google Calendar,
-- Google Drive and OneDrive tokens that previously lived in Google Sheet tabs.
-- One connection per organization, provider and (lower-cased) user email.
-- The table has never been written to, so the unique index is safe to add.

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_connections_org_provider_email_uidx"
  ON "oauth_connections" ("organization_id", "provider", "user_email");
