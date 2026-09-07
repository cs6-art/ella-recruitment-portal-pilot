ALTER TABLE "application_status_history"
  ADD COLUMN IF NOT EXISTS "notification_event_type" text NOT NULL DEFAULT '';
ALTER TABLE "application_status_history"
  ADD COLUMN IF NOT EXISTS "notification_attempted_at" timestamptz;
ALTER TABLE "application_status_history"
  ADD COLUMN IF NOT EXISTS "notification_sent_at" timestamptz;
ALTER TABLE "application_status_history"
  ADD COLUMN IF NOT EXISTS "notification_provider_id" text NOT NULL DEFAULT '';
ALTER TABLE "application_status_history"
  ADD COLUMN IF NOT EXISTS "notification_recipient" text NOT NULL DEFAULT '';
ALTER TABLE "application_status_history"
  ADD COLUMN IF NOT EXISTS "notification_intended_recipient" text NOT NULL DEFAULT '';
