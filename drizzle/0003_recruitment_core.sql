-- Phase 2 backend migration — recruitment core (minimum-viable normalized schema).
--
-- STATUS: drafted for review. Additive DDL only. Applying it creates empty
-- tables; NOTHING reads or writes them until the internal API + shadow-write
-- are enabled per entity (see docs/DATABASE-MIGRATION-PLAN.md phases C+). It
-- does not touch credit_ledger/credit_balance/payments or CREDITS_BACKEND.
--
-- Design notes:
--  * applicants (person) is separate from applications (person -> role).
--  * status/enum-like columns are `text` + CHECK constraints, not Postgres
--    ENUM types — same integrity, cheaper to evolve, and keeps the naive
--    semicolon-split migration runner safe (no procedural/dollar-quoted SQL).
--  * every human id from Sheets is kept as `external_id`/`code` UNIQUE for
--    traceability and n8n idempotency. No Sheet row number becomes an id.
--  * detail/child collections start as `jsonb` and are promoted to tables only
--    when a query needs to filter/join on them.
--  * updated_at is maintained by the app (Drizzle $onUpdate) — no DB trigger.

-- ---------------------------------------------------------------------------
-- Reference / identity
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "departments" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"       text NOT NULL,
  "name_key"   text NOT NULL UNIQUE,               -- lower(trim(name)); the dedupe key
  "active"     boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "users" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"                       text NOT NULL UNIQUE,          -- identity (normalized lowercase)
  "full_name"                   text NOT NULL DEFAULT '',
  "access_role"                 text NOT NULL DEFAULT '',      -- preset label (informational)
  "department_id"               uuid REFERENCES "departments" ("id"),
  "can_create_role"             boolean NOT NULL DEFAULT false,
  "can_review_role"             boolean NOT NULL DEFAULT false,
  "can_approve_role"            boolean NOT NULL DEFAULT false,
  "can_edit_settings"           boolean NOT NULL DEFAULT false,
  "can_manage_users"            boolean NOT NULL DEFAULT false,
  "can_review_department_role"  boolean NOT NULL DEFAULT false,
  "active"                      boolean NOT NULL DEFAULT true,
  "created_at"                  timestamptz NOT NULL DEFAULT now(),
  "updated_at"                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "users_active_idx"        ON "users" ("active");
CREATE INDEX IF NOT EXISTS "users_department_id_idx" ON "users" ("department_id");

CREATE TABLE IF NOT EXISTS "oauth_connections" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_email"        text NOT NULL,
  "provider"          text NOT NULL CHECK ("provider" IN ('google_calendar','google_drive','microsoft_drive')),
  "access_token_enc"  text NOT NULL DEFAULT '',
  "refresh_token_enc" text NOT NULL DEFAULT '',
  "token_expires_at"  timestamptz,
  "scope"             text NOT NULL DEFAULT '',
  "account_email"     text NOT NULL DEFAULT '',
  "connected_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("user_email", "provider")
);

CREATE TABLE IF NOT EXISTS "portal_settings" (
  "key"        text PRIMARY KEY,
  "value"      text NOT NULL DEFAULT '',
  "category"   text NOT NULL DEFAULT '',
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" text NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------------------
-- Roles / requisitions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "roles" (
  "id"                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "external_id"               text NOT NULL UNIQUE,            -- Sheet Role_ID as-is
  "code"                      text UNIQUE,                     -- CSE01… (null while DRAFT-)
  "title"                     text NOT NULL DEFAULT '',
  "department_id"             uuid REFERENCES "departments" ("id"),
  "department_snapshot"       text NOT NULL DEFAULT '',
  "request_type"              text NOT NULL DEFAULT '' CHECK ("request_type" IN ('','staff_addition','staff_replacement')),
  "vacancies"                 integer NOT NULL DEFAULT 1,
  "reason"                    text NOT NULL DEFAULT '',
  "target_hiring_date"        date,
  "status"                    text NOT NULL DEFAULT 'draft'
    CHECK ("status" IN ('draft','pending_hr_discussion','approved','recruitment_setup','job_posted','returned_for_revision','on_hold','rejected')),
  "recruitment_setup_status"  text NOT NULL DEFAULT 'draft'
    CHECK ("recruitment_setup_status" IN ('draft','recruitment_ready','ready_for_publishing','published')),
  "requester_user_id"         uuid REFERENCES "users" ("id"),
  "requester_email"           text NOT NULL DEFAULT '',
  "requester_name"            text NOT NULL DEFAULT '',
  "submitted_by_email"        text NOT NULL DEFAULT '',
  "hr_calendar_email"         text NOT NULL DEFAULT '',
  "application_link"          text NOT NULL DEFAULT '',
  "posted_at"                 timestamptz,
  "posted_by"                 text NOT NULL DEFAULT '',
  "posting_confirmed"         boolean NOT NULL DEFAULT false,
  "latest_comments"           text NOT NULL DEFAULT '',
  "approved_by"               text NOT NULL DEFAULT '',
  "approved_at"               timestamptz,
  "setup"                     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- ~40 recruitment-setup fields
  "evaluation_fields"         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- per-role screening rubric
  "availability_rules"        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- virtual-slot rules
  "archive"                   jsonb NOT NULL DEFAULT '{}'::jsonb,   -- legacy Management-Approval data (history only)
  "source"                    text NOT NULL DEFAULT '',
  "created_at"                timestamptz NOT NULL DEFAULT now(),
  "updated_at"                timestamptz NOT NULL DEFAULT now(),
  "updated_by_email"          text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "roles_status_idx"          ON "roles" ("status");
CREATE INDEX IF NOT EXISTS "roles_department_id_idx"   ON "roles" ("department_id");
CREATE INDEX IF NOT EXISTS "roles_requester_email_idx" ON "roles" ("requester_email");
CREATE INDEX IF NOT EXISTS "roles_created_at_idx"      ON "roles" ("created_at" DESC);

CREATE TABLE IF NOT EXISTS "role_status_history" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "role_id"             uuid NOT NULL REFERENCES "roles" ("id"),
  "changed_at"          timestamptz NOT NULL DEFAULT now(),
  "changed_by_name"     text NOT NULL DEFAULT '',
  "changed_by_email"    text NOT NULL DEFAULT '',
  "previous_status"     text NOT NULL DEFAULT '',
  "new_status"          text NOT NULL DEFAULT '',
  "comments"            text NOT NULL DEFAULT '',
  "action"              text NOT NULL DEFAULT '',
  "action_source"       text NOT NULL DEFAULT '',
  "action_request_id"   text UNIQUE,                            -- idempotency
  "access_role"         text NOT NULL DEFAULT '',
  "department"          text NOT NULL DEFAULT '',
  "notification_status" text NOT NULL DEFAULT '' CHECK ("notification_status" IN ('','sent','pending','failed','not_configured')),
  "notification_error"  text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "role_status_history_role_id_changed_at_idx" ON "role_status_history" ("role_id", "changed_at");

-- ---------------------------------------------------------------------------
-- Applicants / applications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "applicants" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "primary_email" text NOT NULL UNIQUE,                         -- normalized lowercase — dedupe key
  "full_name"     text NOT NULL DEFAULT '',
  "phone_e164"    text NOT NULL DEFAULT '',
  "country"       text NOT NULL DEFAULT '',
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  "notes"         text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "applicants_phone_e164_idx" ON "applicants" ("phone_e164");

CREATE TABLE IF NOT EXISTS "applicant_aliases" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "applicant_id"  uuid NOT NULL REFERENCES "applicants" ("id"),
  "kind"          text NOT NULL CHECK ("kind" IN ('email','name','phone')),
  "value"         text NOT NULL,
  "source"        text NOT NULL DEFAULT '',
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("kind", "value")
);

CREATE TABLE IF NOT EXISTS "resume_files" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "storage_ref"    text NOT NULL UNIQUE,                        -- Drive fileId
  "sha256"         text NOT NULL DEFAULT '',
  "filename"       text NOT NULL DEFAULT '',
  "mime_type"      text NOT NULL DEFAULT '',
  "size"           integer NOT NULL DEFAULT 0,
  "kind"           text NOT NULL DEFAULT '' CHECK ("kind" IN ('','pdf','docx','doc')),
  "text_extracted" boolean NOT NULL DEFAULT false,
  "uploaded_at"    timestamptz NOT NULL DEFAULT now(),
  "expires_at"     timestamptz
);
CREATE INDEX IF NOT EXISTS "resume_files_sha256_idx" ON "resume_files" ("sha256");

CREATE TABLE IF NOT EXISTS "applications" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "external_id"         text NOT NULL UNIQUE,                   -- Sheet Application_ID as-is
  "applicant_id"        uuid NOT NULL REFERENCES "applicants" ("id"),
  "role_id"             uuid NOT NULL REFERENCES "roles" ("id"),
  "source"              text NOT NULL DEFAULT '' CHECK ("source" IN ('','direct','referral','walk_in','agency','existing_database','hr_invitation','bulk_upload','drive_import','onedrive_import')),
  "source_detail"       text NOT NULL DEFAULT '',
  "applied_at"          timestamptz NOT NULL DEFAULT now(),
  "consent_at"          timestamptz,
  "resume_file_id"      uuid REFERENCES "resume_files" ("id"),
  "department_snapshot" text NOT NULL DEFAULT '',
  "current_stage"       text NOT NULL DEFAULT 'resume_review'
    CHECK ("current_stage" IN ('resume_review','resume_approved','voice_booking_pending','voice_scheduled','voice_review_pending','approved_for_final','final_scheduled','final_decision_pending','passed_final','rejected','withdrawn')),
  "withdrawn"           boolean NOT NULL DEFAULT false,
  -- 1:1 application profile / HR stage decisions (merged in, not a separate table)
  "candidate_name"      text NOT NULL DEFAULT '',
  "email"              text NOT NULL DEFAULT '',
  "phone"              text NOT NULL DEFAULT '',
  "preferred_mobile"   text NOT NULL DEFAULT '',
  "applicant_country"  text NOT NULL DEFAULT '',
  "resume_hr_decision" text NOT NULL DEFAULT '' CHECK ("resume_hr_decision" IN ('','approve','reject','manual_review','pending')),
  "resume_hr_decision_at" timestamptz,
  "resume_hr_reviewer" text NOT NULL DEFAULT '',
  "resume_hr_comments" text NOT NULL DEFAULT '',
  "voice_hr_decision"  text NOT NULL DEFAULT '' CHECK ("voice_hr_decision" IN ('','approve','reject','manual_review','pending')),
  "voice_hr_comments"  text NOT NULL DEFAULT '',
  "final_hr_decision"  text NOT NULL DEFAULT '' CHECK ("final_hr_decision" IN ('','approve','reject','manual_review','pending')),
  "final_interview_comments" text NOT NULL DEFAULT '',
  "final_interview_venue"    text NOT NULL DEFAULT '',
  "legacy_status"      jsonb NOT NULL DEFAULT '{}'::jsonb,      -- raw pre-reconciliation status columns
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "applications_role_id_idx"        ON "applications" ("role_id");
CREATE INDEX IF NOT EXISTS "applications_applicant_id_idx"   ON "applications" ("applicant_id");
CREATE INDEX IF NOT EXISTS "applications_current_stage_idx"  ON "applications" ("current_stage");
CREATE INDEX IF NOT EXISTS "applications_applied_at_idx"     ON "applications" ("applied_at" DESC);
CREATE INDEX IF NOT EXISTS "applications_role_stage_idx"     ON "applications" ("role_id", "current_stage");

CREATE TABLE IF NOT EXISTS "screening_results" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id"      uuid NOT NULL UNIQUE REFERENCES "applications" ("id"),
  "match_score"         integer,
  "recommendation"      text NOT NULL DEFAULT '',
  "summary"             text NOT NULL DEFAULT '',
  "strengths"           text NOT NULL DEFAULT '',
  "gaps"                text NOT NULL DEFAULT '',
  "interview_questions" text NOT NULL DEFAULT '',
  "evaluation_scores"   jsonb NOT NULL DEFAULT '[]'::jsonb,
  "screened_at"         timestamptz,
  "raw"                 jsonb,
  "created_at"          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "screening_results_match_score_idx" ON "screening_results" ("match_score");

CREATE TABLE IF NOT EXISTS "screening_invitations" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "role_id"     uuid NOT NULL REFERENCES "roles" ("id"),
  "token_hash"  text NOT NULL UNIQUE,
  "email"       text NOT NULL DEFAULT '',
  "status"      text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active','used','revoked','expired')),
  "created_by"  text NOT NULL DEFAULT '',
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "expires_at"  timestamptz,
  "used_at"     timestamptz,
  "application_id" uuid REFERENCES "applications" ("id")
);
CREATE INDEX IF NOT EXISTS "screening_invitations_role_id_idx" ON "screening_invitations" ("role_id");

CREATE TABLE IF NOT EXISTS "bulk_screening_queue_items" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_id"             text NOT NULL DEFAULT '',
  "role_id"              uuid NOT NULL REFERENCES "roles" ("id"),
  "dedupe_key"           text NOT NULL,                          -- BULK-<ROLE>-<sha256>
  "resume_sha256"        text NOT NULL DEFAULT '',
  "drive_file_id"        text NOT NULL DEFAULT '',
  "filename"             text NOT NULL DEFAULT '',
  "file_url"             text NOT NULL DEFAULT '',
  "mime_type"            text NOT NULL DEFAULT '',
  "status"               text NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued','processing','screened','failed','skipped')),
  "application_id"       uuid REFERENCES "applications" ("id"),
  "candidate_name"       text NOT NULL DEFAULT '',
  "candidate_email"      text NOT NULL DEFAULT '',
  "preferred_mobile"     text NOT NULL DEFAULT '',
  "applicant_country"    text NOT NULL DEFAULT '',
  "error_message"        text NOT NULL DEFAULT '',
  "attempt_count"        integer NOT NULL DEFAULT 0,
  "source"               text NOT NULL DEFAULT '' CHECK ("source" IN ('','upload','drive','onedrive')),
  "environment"          text NOT NULL DEFAULT '',
  "is_uat"               boolean NOT NULL DEFAULT false,
  "job_id"               text NOT NULL DEFAULT '',
  "discovered_at"        timestamptz NOT NULL DEFAULT now(),
  "processing_started_at" timestamptz,
  "processed_at"         timestamptz,
  "updated_at"           timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("role_id", "resume_sha256")
);
CREATE INDEX IF NOT EXISTS "bulk_queue_batch_id_idx"     ON "bulk_screening_queue_items" ("batch_id");
CREATE INDEX IF NOT EXISTS "bulk_queue_role_status_idx"  ON "bulk_screening_queue_items" ("role_id", "status");

-- ---------------------------------------------------------------------------
-- Voice + final interview
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "interview_slots" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slot_code"            text UNIQUE,
  "interview_type"       text NOT NULL CHECK ("interview_type" IN ('voice','final')),
  "role_id"              uuid REFERENCES "roles" ("id"),
  "starts_at"            timestamptz NOT NULL,
  "ends_at"              timestamptz NOT NULL,
  "timezone"             text NOT NULL DEFAULT '',
  "status"               text NOT NULL DEFAULT 'available'
    CHECK ("status" IN ('available','booked','blocked','expired','cancelled','no_show')),
  "application_id"       uuid REFERENCES "applications" ("id"),
  "candidate_name"       text NOT NULL DEFAULT '',
  "candidate_email"      text NOT NULL DEFAULT '',
  "booked_at"            timestamptz,
  "interviewer_name"     text NOT NULL DEFAULT '',
  "interviewer_email"    text NOT NULL DEFAULT '',
  "hod_name"             text NOT NULL DEFAULT '',
  "hod_email"            text NOT NULL DEFAULT '',
  "calendar_event_id"    text NOT NULL DEFAULT '',
  "calendar_event_link"  text NOT NULL DEFAULT '',
  "calendar_event_status" text NOT NULL DEFAULT '',
  "calendar_event_error" text NOT NULL DEFAULT '',
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "interview_slots_role_type_status_idx" ON "interview_slots" ("role_id", "interview_type", "status");
CREATE INDEX IF NOT EXISTS "interview_slots_starts_at_idx"        ON "interview_slots" ("starts_at");
CREATE INDEX IF NOT EXISTS "interview_slots_application_id_idx"   ON "interview_slots" ("application_id");

CREATE TABLE IF NOT EXISTS "voice_call_attempts" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id"   uuid NOT NULL REFERENCES "applications" ("id"),
  "role_id"          uuid REFERENCES "roles" ("id"),
  "attempt_number"   integer NOT NULL DEFAULT 1,
  "max_attempts"     integer NOT NULL DEFAULT 3,
  "scheduled_at"     timestamptz,
  "retry_after"      timestamptz,
  "status"           text NOT NULL DEFAULT 'scheduled'
    CHECK ("status" IN ('scheduled','queued','calling','initiated','in_progress','completed','retry_scheduled','no_show','cancelled')),
  "outcome"          text CHECK ("outcome" IN ('completed','no_answer','busy','wrong_person','no_show','cancelled')),
  "preferred_mobile" text NOT NULL DEFAULT '',
  "contact_number"   text NOT NULL DEFAULT '',
  "applicant_country" text NOT NULL DEFAULT '',
  "provider_call_id" text NOT NULL DEFAULT '',
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "voice_call_attempts_application_id_idx" ON "voice_call_attempts" ("application_id");
CREATE INDEX IF NOT EXISTS "voice_call_attempts_status_idx"         ON "voice_call_attempts" ("status");
CREATE INDEX IF NOT EXISTS "voice_call_attempts_scheduled_at_idx"   ON "voice_call_attempts" ("scheduled_at");

CREATE TABLE IF NOT EXISTS "voice_interview_results" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id"    uuid NOT NULL REFERENCES "applications" ("id"),
  "attempt_id"       uuid REFERENCES "voice_call_attempts" ("id"),
  "score"            integer,
  "recommendation"   text NOT NULL DEFAULT '',
  "strengths"        text NOT NULL DEFAULT '',
  "concerns"         text NOT NULL DEFAULT '',
  "summary"          text NOT NULL DEFAULT '',
  "transcript"       text NOT NULL DEFAULT '',
  "evaluation_scores" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "call_status"      text NOT NULL DEFAULT '',
  "call_final_status" text NOT NULL DEFAULT '',
  "provider_event_type" text NOT NULL DEFAULT '',
  "result_received_at" timestamptz,
  "call_completed_at" timestamptz,
  "raw"             jsonb,
  "created_at"      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "voice_interview_results_application_id_created_at_idx" ON "voice_interview_results" ("application_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "booking_tokens" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id" uuid NOT NULL REFERENCES "applications" ("id"),
  "kind"           text NOT NULL CHECK ("kind" IN ('voice','final')),
  "token_hash"     text NOT NULL UNIQUE,
  "status"         text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','used','booked','expired','revoked')),
  "expires_at"     timestamptz,
  "used_at"        timestamptz,
  "link"           text NOT NULL DEFAULT '',
  "created_at"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "booking_tokens_application_id_kind_idx" ON "booking_tokens" ("application_id", "kind");

-- ---------------------------------------------------------------------------
-- History / audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "application_status_history" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id" uuid NOT NULL REFERENCES "applications" ("id"),
  "changed_at"     timestamptz NOT NULL DEFAULT now(),
  "stage"          text NOT NULL DEFAULT '',
  "previous_stage" text NOT NULL DEFAULT '',
  "new_stage"      text NOT NULL DEFAULT '',
  "decision"       text NOT NULL DEFAULT '',
  "actor_name"     text NOT NULL DEFAULT '',
  "actor_email"    text NOT NULL DEFAULT '',
  "comments"       text NOT NULL DEFAULT '',
  "source"         text NOT NULL DEFAULT '',
  "action_request_id" text UNIQUE,
  "notification_status" text NOT NULL DEFAULT '',
  "notification_error"  text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "application_status_history_application_id_changed_at_idx" ON "application_status_history" ("application_id", "changed_at");
