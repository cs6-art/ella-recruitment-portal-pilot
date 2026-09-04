# n8n hot paths → internal API (Postgres) — migration spec

> **Status: SPEC + SCAFFOLD.** The `/api/internal/recruitment/*` endpoints and
> the recruitment-core schema exist in the repo (drafted, feature-flagged off).
> **No workflow cutover is published.** Do not repoint a live pilot workflow
> until: the recruitment-core migration is applied to the pilot DB, the entity
> is shadow-written and parity-checked, and `INTERNAL_API_ENTITIES` lists it.

## Why

Every failing pilot workflow this cycle failed on **Google Sheets 429** — too
many reads per minute on one service account. Staggering crons and cutting
retries only spreads a fixed budget. Moving the operational *polling* to an
authenticated Postgres-backed API removes those reads entirely; Sheets stays as
the reporting/export/history mirror.

## Auth model

- n8n calls `https://<portal>/api/internal/recruitment/*` with
  `Authorization: Bearer $INTERNAL_API_SECRET` (or `X-Internal-Secret`).
- n8n **never** gets a `DATABASE_URL`. All validation, idempotency, status
  rules and writes stay in the portal.
- Endpoints are `no-store`, `X-Robots-Tag: none`, no cookie/session fallback.
- Per-entity rollout flag: authentication and entity authorization happen before
  route logic. A missing entity allowlist is a `503`, a disallowed entity is a
  `403`, and an allowed entity without `DATABASE_URL` is a `503`. No security
  failure returns `{ ok: true, migrated: false }`.

## Endpoints (implemented, inactive target surface)

| Method + path | Entity flag | Purpose |
|---|---|---|
| `GET /api/internal/recruitment/voice/queue` | `voice_queue` | voice calls due to dial |
| `GET /api/internal/recruitment/voice/results?ids=APP-1,APP-2` | `voice_results` | latest voice-result status per application |
| `POST /api/internal/recruitment/voice/results` | `voice_results` | ingest a completed voice interview result (idempotent) |
| `GET /api/internal/recruitment/hr-decisions/queue` | `hr_decisions` | applications awaiting an HR decision |
| `GET /api/internal/recruitment/bulk/queue?status=queued,processing` | `bulk_queue` | bulk resume screening queue |
| `POST /api/internal/recruitment/bulk/queue/claim` | `bulk_queue` | atomic bulk queue claim |
| `POST /api/internal/recruitment/bulk/queue/status` | `bulk_queue` | idempotent bulk status update |
| `GET/POST /api/internal/recruitment/roles` | `roles` | role/requisition read/create |
| `POST /api/internal/recruitment/roles/status` | `roles` | transactional role status/history update |
| `GET/POST /api/internal/recruitment/applicants` | `applicants` | applicant read/upsert |
| `GET/POST /api/internal/recruitment/applications` | `applications` | application read/create |
| `GET /api/internal/recruitment/applications/detail` | `applications` | application lookup |
| `GET/POST /api/internal/recruitment/screening` | `screening` | screening read/upsert |
| `POST /api/internal/recruitment/screening/invitations` | `screening_invitations` | screening invitation creation |
| `POST /api/internal/recruitment/hr-decisions` | `hr_decisions` | transactional HR decision |
| `POST /api/internal/recruitment/voice/queue/claim` | `voice_queue` | atomic voice claim |
| `POST /api/internal/recruitment/voice/attempts/status` | `voice_attempts` | voice attempt state update |
| `POST /api/internal/recruitment/voice/logs` | `voice_logs` | provider call-log dedupe |
| `GET/POST /api/internal/recruitment/bookings` | `booking` | slot listing and atomic booking |
| `POST /api/internal/recruitment/bookings/tokens` | `booking` | single-use booking token creation |
| `GET/POST /api/internal/recruitment/status-history` | `status_history` | transactional application stage/history |
| `GET/POST /api/internal/recruitment/notifications` | `notifications` | notification queue/status data |

These target endpoints remain inactive until each entity is explicitly added to
`INTERNAL_API_ENTITIES` and the corresponding pilot n8n workflow is reviewed.

## Per-workflow migration plan

`WORKFLOW | CURRENT SHEETS READ/WRITE | FUTURE API | POSTGRES TABLES | CUTOVER ORDER`

| Workflow | Current Sheets read / write | Future API | Postgres tables | Cutover order |
|---|---|---|---|---|
| `29HvXI7H4eKUJ1Uv` Voice Result Status Sync | **R** `High_Match_Profile` (full), `Voice_Interview_Results` (full), `Voice_Call_Queue` (full); **W** `High_Match_Profile` status cells | **R** `GET voice/results?ids=…` + `GET voice/queue`; **W** `POST voice/results` (Vapi already) then portal reconciles stage | `applications`, `voice_interview_results`, `voice_call_attempts`, `application_status_history` | **1** — worst 429 offender, read-only reconciler, lowest blast radius |
| `cTJHm2ZAJQap7uWW` Scheduled Voice Calling | **R** `Voice_Call_Queue` (full), `High_Match_Profile` (gid), `Role_Requests` (System Prompt); **W** `Voice_Call_Queue` lock/status cells, `High_Match_Profile` status | **R** `GET voice/queue` (returns due attempts + resolved prompt); **W** `POST voice/attempts/{id}/status` (`calling`/`initiated`/`missed`/`error`) | `voice_call_attempts`, `applications`, `roles` (setup jsonb for the prompt), `interview_slots` | **2** — writes call state; needs the attempt state machine in Postgres first |
| HR decision / F2F invite (`rsfQl6nkVWd7Zo3B`) | **R** `High_Match_Profile` (full) for `Resume_HR_Decision`/`Voice_HR_Decision`; **W** booking token cols, `High_Match_Profile` status, `Final_Interview_Tracking` | **R** `GET hr-decisions/queue`; **W** `POST applications/{extId}/decision` + `POST booking-tokens` | `applications`, `booking_tokens`, `application_status_history`, `interview_slots` (final) | **3** — decision writes; RBAC-sensitive, keep portal as the only writer |
| Voice Booking Invitations (`gGTvRHKaHTX95y0b`) | **R** `High_Match_Profile` (full) for approved-awaiting-booking; **W** `High_Match_Profile` invitation status + booking link | **R** `GET voice/bookings/queue`; **W** `POST applications/{extId}/voice-invitation` | `applications`, `booking_tokens` | **4** — already stabilised on Sheets; migrate after the readers above |
| HR Approval Notifications (`fBL9aYz5PNne0jh6`) | **R** `High_Match_Profile` (full); **W** rejection/approval status, secure booking token | **R** `GET hr-decisions/queue?stage=resume`; **W** `POST applications/{extId}/resume-decision` | `applications`, `booking_tokens`, `application_status_history` | **4** — pairs with the decision workflow |
| Voice Booking Confirmation (`NN8r5PPUktrPkVIr`) | **R** `High_Match_Profile` (booked, confirmation not sent) | **R** `GET bookings/confirmations/queue?kind=voice` | `interview_slots`, `applications` | **5** |
| Final Booking Confirmation (`SQgv92WepQCNmAgx`) | **R** `High_Match_Profile` / `Final_Interview_Tracking` | **R** `GET bookings/confirmations/queue?kind=final` | `interview_slots`, `final` state on `applications` | **5** |
| Bulk Resume Intake (`P3cEDCDf70Os1Ae9`) | **R/W** `Bulk_Resume_Queue` (append-only events) | **R** `GET bulk/queue`; **W** `POST bulk/queue/{dedupeKey}/status` | `bulk_screening_queue_items` | **6** — the portal already owns intake; n8n only updates status |

### Cutover procedure per workflow

1. Apply `drizzle/0003_recruitment_core.sql` to the pilot DB (`npm run db:migrate`).
2. Shadow-write the entity from the portal (portal writes both Sheets + PG).
3. `npm run db:backfill:recruitment -- --only=<entity>` then
   `npm run db:check:recruitment` → require parity.
4. Add the entity to `INTERNAL_API_ENTITIES`; confirm the endpoint returns
   `migrated: true` with correct data.
5. In n8n, add the API read **before** the Sheets read, with the Sheets read as
   an `onError` fallback. Observe one full cycle.
6. Remove the Sheets read. Keep any Sheets **write** as a mirror until the
   portal owns that write too.
7. Roll back = disable the workflow's API branch and restore its saved Sheets
   version. Removing an entity from `INTERNAL_API_ENTITIES` now correctly
   returns `403`; it is not a successful fallback response.

Sheets stays as: reporting dashboards, CSV export, historical mirror.
