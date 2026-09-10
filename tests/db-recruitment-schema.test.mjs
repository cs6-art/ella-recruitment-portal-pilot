import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("recruitment-core migration + schema keep applicants separate from applications", () => {
  const sql = read("drizzle/0003_recruitment_core.sql");
  assert.match(sql, /create table if not exists "applicants"/i);
  assert.match(sql, /create table if not exists "applications"/i);
  // applications references BOTH a person and a role
  assert.match(sql, /"applicant_id"\s+uuid NOT NULL REFERENCES "applicants"/i);
  assert.match(sql, /"role_id"\s+uuid NOT NULL REFERENCES "roles"/i);
  // reapplication allowed: no unique on (applicant_id, role_id)
  assert.doesNotMatch(sql, /UNIQUE \("applicant_id", "role_id"\)/i);
});

test("every Sheet human id is preserved as external_id / code UNIQUE — no row number becomes an id", () => {
  const sql = read("drizzle/0003_recruitment_core.sql");
  assert.match(sql, /"external_id"\s+text NOT NULL UNIQUE/i); // roles + applications
  assert.match(sql, /"id"\s+uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/i);
  assert.doesNotMatch(sql, /row_number|sheet_row/i);
});

test("FKs, unique constraints, and indexes are present on the hot tables", () => {
  const sql = read("drizzle/0003_recruitment_core.sql");
  assert.match(sql, /REFERENCES "applications" \("id"\)/);
  assert.match(sql, /UNIQUE \("role_id", "resume_sha256"\)/i); // bulk dedupe now enforced
  assert.match(sql, /create index if not exists "applications_role_stage_idx"/i);
  assert.match(sql, /create index if not exists "voice_call_attempts_status_idx"/i);
  assert.match(sql, /"action_request_id"\s+text UNIQUE/i); // idempotency on history
});

test("timestamps are timestamptz and status columns are constrained", () => {
  const sql = read("drizzle/0003_recruitment_core.sql");
  assert.doesNotMatch(sql, /timestamp(?!tz)\b/i);
  assert.match(sql, /CHECK \("current_stage" IN \(/i);
  assert.match(sql, /CHECK \("status" IN \('scheduled','queued','calling'/i);
});

test("the Drizzle recruitment schema remains separate from the live credit schema", () => {
  const recruit = read("src/db/schema-recruitment.ts");
  for (const t of ["applicants", "applications", "roles", "voice_call_attempts", "voice_call_logs", "booking_tokens", "application_status_history"]) {
    assert.match(recruit, new RegExp(`pgTable\\(\\s*"${t}"`), `missing table ${t}`);
  }
  assert.match(recruit, /\$onUpdate\(\(\) => new Date\(\)\)/); // app-maintained updated_at
});

test("voice-call logs migration preserves provider audit fields and deduplicates source events", () => {
  const sql = read("drizzle/0004_voice_call_logs.sql");
  for (const field of ["application_id", "voice_call_attempt_id", "provider_call_id", "provider_event_id", "source_event_key", "duration_seconds", "recording_url", "communication_score", "completeness_score", "follow_up_questions", "transcript", "summary", "recommendation", "error_details", "raw_result", "started_at", "ended_at"]) {
    assert.match(sql, new RegExp(`"${field}"`), `missing ${field}`);
  }
  assert.match(sql, /"source_event_key"\s+text NOT NULL UNIQUE/i);
  assert.match(sql, /REFERENCES "applications" \("id"\)/i);
  assert.match(sql, /REFERENCES "voice_call_attempts" \("id"\)/i);
  assert.doesNotMatch(sql, /DROP|TRUNCATE|DELETE FROM|access_token|refresh_token/i);
});

test("voice attempt migration matches the provider dispatch state machine", () => {
  const sql = read("drizzle/0006_voice_attempt_dispatch_states.sql");
  assert.match(sql, /'dispatching'/);
  assert.match(sql, /'failed'/);
  assert.match(sql, /'system_failure'/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS "voice_call_attempts_status_check"/);
});

test("the migration runner will accept the new files (no functions / DO blocks / dollar-quoting)", () => {
  for (const f of ["drizzle/0002_payments.sql", "drizzle/0003_recruitment_core.sql", "drizzle/0004_voice_call_logs.sql", "drizzle/0005_candidate_email_events.sql", "drizzle/0006_voice_attempt_dispatch_states.sql", "drizzle/0007_resume_extraction_cache.sql", "drizzle/0008_notification_claim_leases.sql"]) {
    const sql = read(f);
    assert.doesNotMatch(sql, /\$\$|CREATE (OR REPLACE )?FUNCTION|DO \$/i);
  }
});

test("candidate email events extend application history without changing credit/payment tables", () => {
  const sql = read("drizzle/0005_candidate_email_events.sql");
  for (const field of ["notification_event_type", "notification_attempted_at", "notification_sent_at", "notification_provider_id", "notification_recipient", "notification_intended_recipient"]) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS \\"${field}\\"`, "i"), `missing ${field}`);
  }
  assert.doesNotMatch(sql, /DROP|TRUNCATE|DELETE FROM|credit_balance|credit_ledger|payments/i);
});

test("notification claim migration adds retry leases and queue indexes without destructive DDL", () => {
  const sql = read("drizzle/0008_notification_claim_leases.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "notification_attempted_at"/i);
  assert.match(sql, /role_status_history_notification_queue_idx/i);
  assert.match(sql, /application_status_history_notification_queue_idx/i);
  assert.doesNotMatch(sql, /DROP|TRUNCATE|DELETE FROM/i);
});

test("the migration runner requires an explicit target and cannot leap to a later file", () => {
  const runner = read("src/db/migrate.mjs");
  assert.match(runner, /--target=/);
  assert.match(runner, /Refusing to apply/);
  assert.match(runner, /missingPrerequisites/);
  assert.match(runner, /process\.exitCode = 2/);
});
