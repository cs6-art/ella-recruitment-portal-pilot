# Pilot recruitment backfill mapping

The pilot uses two workbooks. `GOOGLE_CANDIDATE_SPREADSHEET_ID` is the roles
workbook; `GOOGLE_SHEETS_SPREADSHEET_ID` is the main operational workbook.
Backfill tooling keeps that distinction explicit.

| Source sheet/tab | Workbook | Postgres table | Backfill implemented? | Required for cutover? |
|---|---|---|---|---|
| `Role_Requests` | roles | `roles`, `departments` | Yes | Yes |
| `Role_Status_History` | roles | `role_status_history` | Yes | Yes |
| `User_Directory` | roles | `users` | Yes | Yes for auth/RBAC |
| `Settings` | main | `portal_settings` | Yes - allowlisted non-secret operational keys only | Yes for booking/workflow continuity |
| `Calendar_Connections` | roles | `oauth_connections` | No - plaintext tokens require encryption/key ownership first | Yes only for calendar continuity |
| `High_Match_Profile` | main | applicants, aliases, resume files, applications, screening, booking tokens | Yes | Yes |
| `Candidate_Status_History` | main | `application_status_history` | Yes | Yes for audit continuity |
| `Resume_Screening_Invitations` | main | `screening_invitations` | Yes | Yes for outstanding invitations |
| `Bulk_Resume_Queue` | main | `bulk_screening_queue_items` | Yes | Yes for queued processing |
| `Interview_Slots` | main | `interview_slots` | Yes | Yes |
| `Voice_Call_Queue` | main | `voice_call_attempts` | Yes | Yes before voice cutover |
| `Voice_Interview_Results` | main | `voice_interview_results` | Yes | Yes before voice-result cutover |
| `Voice_Call_Logs` | main | No direct `0003` table | No - requires reviewed archive mapping | Yes for audit |
| `Final_Interview_Tracking` | main | applications final fields + final `interview_slots` | Partial - conflict winner requires review | Yes before final-interview cutover |
| `Bulk_Role_Folder_Map` | main | none in `0003` | No - external Drive routing configuration | No; configure separately |
| `Recruitment_Templates` | roles | none in `0003` | No - configuration should be regenerated/imported | No |
| `Role_AI_Settings` | roles | `roles.setup` | No standalone rows; source is empty | No |

The main `Settings` tab has 23 populated settings. Fifteen allowlisted
booking, workflow, retry, calendar-metadata, and credit-policy keys can be
normalized into `portal_settings`. Portal URLs, n8n URLs, and deployment
values remain ENV/Vercel or external integration configuration.

## Historical role placeholders (policy only; not created yet)

`IS01` (Inside Sales) and `UUD03` (UI/UX Designer) are legitimate legacy
role references: each is absent from the current `Role_Requests` tab but is
referenced by historical/operational records. They must not be remapped to a
different current role ID.

If approved after review, create one inactive placeholder in `roles` for each
original external ID, preserving the source ID exactly:

| external_id | title | code | status | recruitment_setup_status | source | archive |
|---|---|---|---|---|---|---|
| `IS01` | `Inside Sales` | `NULL` | `rejected` | `draft` | `legacy-placeholder` | `{"classification":"historical_legacy","active":false,"original_external_id":"IS01","provenance":{"source":"pilot historical workbooks","reason":"Referenced by historical records; absent from current Role_Requests"}}` |
| `UUD03` | `UI/UX Designer` | `NULL` | `rejected` | `draft` | `legacy-placeholder` | `{"classification":"historical_legacy","active":false,"original_external_id":"UUD03","provenance":{"source":"pilot historical workbooks","reason":"Referenced by historical records; absent from current Role_Requests"}}` |

The remaining fields use their source evidence where available; otherwise they
use the schema defaults. `status='rejected'`, `posting_confirmed=false`, an
empty `application_link`, and `archive.active=false` keep the placeholder out
of active requisition/application flows. The existing schema has no separate
`inactive` enum or `legacy` column, so these exact values are the current
schema-compatible representation. A committed backfill must additionally
assert that new-application queries exclude `source='legacy-placeholder'` or
`archive->>'active'='false'`.

No placeholder row is created by the current dry-run.

## Final interview blank-status rule

The blank row is classified from the row and its related application history,
using the latest explicit terminal signal first. In the observed pilot row,
the related history contains `Final Interview Passed`, so the normalized
status is `completed` even though the tracking row itself has no date/time or
link. If neither the row nor related history has a terminal or scheduling
signal, the normalized status is `historical_unknown`; it must not be
invented as scheduled, completed, no-show, or cancelled. Explicit
no-show/cancelled signals win over scheduling evidence, and a valid
date/time or booking/calendar event without a terminal signal is `scheduled`.

## Voice-call audit destination

`drizzle/0004_voice_call_logs.sql` adds an additive, idempotent destination for
the material fields currently present only in `Voice_Call_Logs`. It is not
executed. `source_event_key` is the dedupe key, provider identifiers are
retained, and raw provider results are JSONB without credentials or tokens.

## Identity rules

- Role identity is `Role_ID`, falling back to `Submission_ID` only when the
  former is blank. No row number is used.
- Application identity is `Application ID`; `Role_ID` resolves the required
  `roles.id` foreign key.
- Applicant identity is normalized email because the source has no stable
  person ID. Reapplications remain separate applications. Name/phone aliases
  are never used for automatic person merges.
- Resume identity is `Resume_File_Id`; file bytes remain in Drive.
- History, invitation, slot, booking, queue, and provider records use source
  stable IDs or deterministic SHA-256-derived UUIDs when no provider ID exists.

## Safety

`src/db/backfill-recruitment.mjs` is dry-run by default. `--commit` is required
for writes, and a committed run writes `_backfill_journal`. It performs no n8n
calls and has no production workbook or production database configuration.
`src/db/check-recruitment-parity.mjs` is read-only and supports explicit
domain selection with `--only=`. In addition to identity/count parity it
compares role status, application stage, screening score/recommendation, voice
result status/provider identity, interview-slot booking status, and bulk-queue
status. A mismatch is reported; the checker never reconciles or writes data.

## Current FK-gap disposition (read-only audit)

The current source audit found no safe automatic remapping or duplicate that
would justify dropping a row. `IS01` and `UUD03` are placeholder candidates;
the other missing role IDs remain manual-review candidates until source
evidence or an approved archive disposition is recorded. Expired/blocked
interview slots and the explicitly failed bulk row are retained as rejected or
failed historical records, not deleted. Blank role attributes that are
allowed by the destination schema are reported separately from role FK
failures.
