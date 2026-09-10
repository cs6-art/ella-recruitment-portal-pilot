ALTER TABLE "role_status_history"
  ADD COLUMN IF NOT EXISTS "notification_attempted_at" timestamptz;

CREATE INDEX IF NOT EXISTS "role_status_history_notification_queue_idx"
  ON "role_status_history" ("notification_status", "notification_attempted_at", "changed_at");

CREATE INDEX IF NOT EXISTS "application_status_history_notification_queue_idx"
  ON "application_status_history" ("notification_status", "notification_attempted_at", "changed_at");
