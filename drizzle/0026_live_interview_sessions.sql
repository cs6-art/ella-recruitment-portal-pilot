-- Live Avatar interview sessions: consent, device check, provider session,
-- transcript, recording, and HR-review analysis for one avatar invitation.
--
-- One row per avatar booking token (the candidate's one-time invitation), so
-- every consent record is traceable to exactly one interview session. The
-- analysis is an HR review aid only; nothing here drives an automated
-- hiring decision.

CREATE TABLE IF NOT EXISTS "live_interview_sessions" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"        uuid NOT NULL REFERENCES "organizations" ("id"),
  "application_id"         uuid NOT NULL REFERENCES "applications" ("id"),
  "applicant_id"           uuid NOT NULL REFERENCES "applicants" ("id"),
  "role_id"                uuid NOT NULL REFERENCES "roles" ("id"),
  "booking_token_id"       uuid NOT NULL UNIQUE REFERENCES "booking_tokens" ("id"),
  "provider"               text NOT NULL DEFAULT 'liveavatar',
  "provider_session_id"    text NOT NULL DEFAULT '',
  "status"                 text NOT NULL DEFAULT 'NOT_STARTED' CHECK ("status" IN ('NOT_STARTED','CONSENTED','DEVICE_CHECK','INTERVIEW_IN_PROGRESS','INTERVIEW_COMPLETED','TRANSCRIPTION_PROCESSING','ANALYSIS_PROCESSING','REVIEW_READY','FAILED')),
  "consent_given"          boolean NOT NULL DEFAULT false,
  "consent_version"        text NOT NULL DEFAULT '',
  "consent_at"             timestamptz,
  "consent_declined_at"    timestamptz,
  "recording_consent"      boolean NOT NULL DEFAULT false,
  "camera_consent"         boolean NOT NULL DEFAULT false,
  "microphone_consent"     boolean NOT NULL DEFAULT false,
  "consent_user_agent"     text NOT NULL DEFAULT '',
  "device_check_at"        timestamptz,
  "camera_ready"           boolean NOT NULL DEFAULT false,
  "microphone_ready"       boolean NOT NULL DEFAULT false,
  "interview_started_at"   timestamptz,
  "interview_completed_at" timestamptz,
  "transcript_source"      text NOT NULL DEFAULT '',
  "transcript_fetched_at"  timestamptz,
  "client_transcript"      jsonb NOT NULL DEFAULT '[]'::jsonb,
  "analysis"               jsonb,
  "analysis_model"         text NOT NULL DEFAULT '',
  "analysis_completed_at"  timestamptz,
  "processing_attempts"    integer NOT NULL DEFAULT 0,
  "processing_lease_until" timestamptz,
  "failure_stage"          text NOT NULL DEFAULT '',
  "last_error"             text NOT NULL DEFAULT '',
  "last_error_at"          timestamptz,
  "recording_status"       text NOT NULL DEFAULT 'not_requested' CHECK ("recording_status" IN ('not_requested','not_consented','not_configured','pending','uploading','available','failed')),
  "recording_storage_ref"  text NOT NULL DEFAULT '',
  "recording_upload_url"   text NOT NULL DEFAULT '',
  "recording_bytes"        bigint NOT NULL DEFAULT 0,
  "recording_mime_type"    text NOT NULL DEFAULT '',
  "recording_error"        text NOT NULL DEFAULT '',
  "needs_hr_review"        boolean NOT NULL DEFAULT false,
  "review_flags"           jsonb NOT NULL DEFAULT '[]'::jsonb,
  "voice_result_id"        uuid REFERENCES "voice_interview_results" ("id"),
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "live_interview_sessions_application_idx" ON "live_interview_sessions" ("application_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "live_interview_sessions_status_idx" ON "live_interview_sessions" ("status", "updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "live_interview_sessions_provider_session_uidx" ON "live_interview_sessions" ("provider", "provider_session_id") WHERE "provider_session_id" <> '';

-- Speaker-labelled transcript, one row per turn. Rewritten atomically when a
-- more authoritative source (the provider transcript) replaces the browser
-- capture, so repeated processing never duplicates turns.
CREATE TABLE IF NOT EXISTS "live_interview_transcript_turns" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations" ("id"),
  "session_id"      uuid NOT NULL REFERENCES "live_interview_sessions" ("id") ON DELETE CASCADE,
  "seq"             integer NOT NULL,
  "speaker"         text NOT NULL CHECK ("speaker" IN ('ai_interviewer','applicant')),
  "text"            text NOT NULL,
  "occurred_at"     timestamptz,
  "relative_ms"     integer,
  "question_index"  integer,
  "source"          text NOT NULL DEFAULT '',
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "live_interview_transcript_turns_session_seq_uidx" ON "live_interview_transcript_turns" ("session_id", "seq");

-- Objective technical/session events only (tab hidden, disconnects, paste).
-- Shown to HR as review indicators, never used as an automatic decision.
CREATE TABLE IF NOT EXISTS "live_interview_integrity_events" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations" ("id"),
  "session_id"      uuid NOT NULL REFERENCES "live_interview_sessions" ("id") ON DELETE CASCADE,
  "event_type"      text NOT NULL,
  "occurred_at"     timestamptz NOT NULL,
  "detail"          text NOT NULL DEFAULT '',
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "live_interview_integrity_events_session_idx" ON "live_interview_integrity_events" ("session_id", "occurred_at")
