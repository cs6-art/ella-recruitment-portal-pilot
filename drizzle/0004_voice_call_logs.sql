-- Additive voice-call audit destination. Do not execute until the voice cutover
-- has been reviewed and the 0003 recruitment backfill is ready.
CREATE TABLE IF NOT EXISTS "voice_call_logs" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id"        uuid NOT NULL REFERENCES "applications" ("id"),
  "voice_call_attempt_id" uuid REFERENCES "voice_call_attempts" ("id"),
  "provider"              text NOT NULL DEFAULT '',
  "provider_call_id"      text NOT NULL DEFAULT '',
  "provider_event_id"     text NOT NULL DEFAULT '',
  "source_event_key"      text NOT NULL UNIQUE,
  "call_status"           text NOT NULL DEFAULT '',
  "duration_seconds"      integer CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0),
  "recording_url"         text NOT NULL DEFAULT '',
  "communication_score"   integer CHECK ("communication_score" IS NULL OR "communication_score" BETWEEN 0 AND 100),
  "completeness_score"    integer CHECK ("completeness_score" IS NULL OR "completeness_score" BETWEEN 0 AND 100),
  "follow_up_questions"   text NOT NULL DEFAULT '',
  "transcript"            text NOT NULL DEFAULT '',
  "summary"               text NOT NULL DEFAULT '',
  "recommendation"        text NOT NULL DEFAULT '',
  "error_details"         text NOT NULL DEFAULT '',
  "raw_result"            jsonb,
  "started_at"            timestamptz,
  "ended_at"              timestamptz,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "voice_call_logs_application_id_idx"
  ON "voice_call_logs" ("application_id", "started_at");
CREATE INDEX IF NOT EXISTS "voice_call_logs_provider_call_id_idx"
  ON "voice_call_logs" ("provider", "provider_call_id");
CREATE INDEX IF NOT EXISTS "voice_call_logs_provider_event_id_idx"
  ON "voice_call_logs" ("provider", "provider_event_id");
