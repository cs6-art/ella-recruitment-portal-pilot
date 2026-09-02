# Database Migration Plan — Ella Recruitment Portal (Pilot)

> **Status: AUDIT & PLAN ONLY.** No migration performed. No schema cutover. No
> switch of `CREDITS_BACKEND` off `dual`. No n8n changes. Prepared 2026-09-02
> from three code-traced audits (Google Sheets dependencies, existing
> Postgres/Neon implementation, recruitment domain data model).

## Operator decisions driving this plan

1. **Timing — "only non-disruptive prep now."** Do Phase A preparation and finish
   the existing credits dual-write zero-divergence soak *during* the pilot. **Do
   NOT** start recruitment-domain shadow-writes, backfill, or read cutover until
   after pilot/UAT sign-off, unless explicitly approved.
2. **End state — "decide per-entity after parity."** Postgres-primary is an
   entity-by-entity decision made *after* shadow-write + backfill + parity +
   rollback readiness + live evidence for that entity. No synchronized big-bang.
3. **External writers — "internal service API."** Migrated entities get n8n/Vapi
   writing through authenticated `/api/internal/*` endpoints (scoped service
   token, server-side only). All validation, idempotency, status rules, logging
   and DB writes centralised in the portal.

## Hard constraints

- Keep `CREDITS_BACKEND=dual`. **Never** switch credits to `postgres` without
  explicit written approval — out of scope for this plan entirely.
- No production behaviour change, no schema cutover, no live n8n workflow edits
  during the audit/plan or during Phase A.
- Preserve RBAC exactly: HR company-wide manage/decide; Management company-wide
  view-only; HOD own-department read-only; Creator-only own requisitions. **No
  active Management Approval workflow.** Max 8 bulk resumes. Current credit
  behaviour. Current voice retry / no-show lifecycle.
- Legacy Management-Approval fields are **archived for history, never migrated as
  active workflow state**.
- Historical data stays in the plan even where the workflow has since changed.

---

## 1. Executive summary

The portal's operational datastore is Google Sheets. Every domain entity except
the Ella Credits ledger lives exclusively in ~20 Sheet tabs across up to three
spreadsheets, read through a per-instance cache that is not multi-instance safe,
and written on the hot paths by **both** the portal and external n8n workflows
using in-process locks for concurrency control. This is unsafe as a long-term
operational database on Vercel's multi-instance serverless runtime: no atomic
writes, append races that silently drop rows, row-number/structural-delete
coupling, free-text statuses, no referential integrity, no person entity, and
silent schema drift.

The credits ledger has already been moved to Neon Postgres with a proven pattern:
an atomic single-statement CTE (balance row + immutable audit row move together),
a `source_entry_id` idempotency key, a `CREDITS_BACKEND` switch
(`sheets`|`dual`|`postgres`), best-effort dual-write, and a fresh-vs-fresh
divergence check. It runs in `dual` today and reconciles 1:1 with the Sheet.

**Recommendation:** proceed **now** only with non-disruptive preparation
(**Phase A**) and completion of the credits dual-write zero-divergence soak
(**Phase B observation**, credits stay on `dual`). Everything that touches
recruitment data — shadow-writes, backfill, parity, read cutover (**Phases
C–H**) — is **NO-GO until after pilot/UAT sign-off and explicit written
approval**, and is then sequenced and cut over **per entity**, each gated on its
own parity evidence and rollback readiness. External writers (n8n, Vapi) move to
authenticated `/api/internal/*` endpoints when their entity migrates; they never
get direct database credentials.

The single most urgent gap regardless of timeline: **there is no Neon backup /
PITR / retention policy**, and a real credit balance already lives in Postgres.
That must be closed in Phase A.

## 2. Current architecture

### Stores

| Store | Holds | Access |
|---|---|---|
| Google Sheets — `GOOGLE_SHEETS_SPREADSHEET_ID` | `Role_Requests`, `Role_Status_History`, `User_Directory`, `Settings`, `Recruitment_Templates`, `Ella_Credit_Ledger`, `Calendar_Connections`, `Drive_Connections`, `Microsoft_Drive_Connections` | Service-account JWT, `src/lib/google-sheets.ts`, `sheets-cache.ts` (20s TTL, process-local, `MIN_READ_INTERVAL_MS=1200`) |
| Google Sheets — `GOOGLE_CANDIDATE_SPREADSHEET_ID` (falls back to the main ID) | `High_Match_Profile`, `Candidate_Status_History`, `Interview_Slots`, `Voice_Call_Queue`, `Voice_Interview_Results`, `Voice_Call_Logs`, `Final_Interview_Tracking`, `Resume_Screening_Invitations` | `src/lib/applicant-workflow.ts`, `candidate-applications.ts`, `resume-screening-invite.ts` |
| Google Sheets — bulk spreadsheet (`bulkResumeSpreadsheetId()`) | `Bulk_Resume_Queue`, `Bulk_Role_Folder_Map`, its own `High_Match_Profile` | `src/lib/bulk-resume-intake.ts`, `candidate-applications.ts` |
| Google Drive (Shared Drive folder) | Resume binaries only (30-day retention); metadata + extracted text go to Sheets | `src/lib/resume-files.ts`; download via HMAC-signed token |
| Neon Postgres | **Only** `credit_ledger`, `credit_balance`, `_migrations` | Drizzle + `@neondatabase/serverless` `neon-http`, lazy client `src/db/client.ts` |
| n8n (external) | Runs role workflow, AI CV screening, invite emails, bulk Drive poller; **writes Sheet rows directly** and returns `notificationStatus` | webhooks with `X-Webhook-Secret`, `actionRequestId` / `X-Idempotency-Key` |
| Vapi (external, not in repo) | Voice calling; reads `Voice_Call_Queue`, writes `Voice_Interview_Results` / `Voice_Call_Logs` / queue status | — |
| Browser localStorage | "new applicants" unread watermark (per device, not synced) | `src/lib/new-applicants.ts` |

### Runtime

Next.js 16 on Vercel serverless (multi-instance, Fluid Compute, no `vercel.json`,
no `maxDuration` set). Concurrency safety for Sheets today = in-process
`Map`/locks (`withReservationLock("voice-capacity")`, `withBulkQueueEventLock`,
sheets read pacing) — **all per-instance, none multi-instance safe** (tracked
risk R-P2-4).

### Credits backend (the one migrated component)

`src/lib/ella-credits.ts` dispatches to `ella-credits-sheets.ts` /
`ella-credits-postgres.ts` by `CREDITS_BACKEND`:

- `sheets` (default): Sheet ledger only; balance = signed sum of `Credits_Delta`;
  non-atomic append (documented overspend window); no guard.
- `dual` (**current pilot setting**): Sheet append first (authoritative), then
  best-effort `mirrorToPostgres()`; mirror failure is logged
  (`[Credits] Postgres mirror write failed`) and swallowed; on a *fresh* read a
  fire-and-forget check logs `[Credits] Divergence` if the two balances differ.
  Reads still come from the Sheet.
- `postgres`: atomic CTE, `credit_balance` id=1 authoritative, guarded
  deductions cannot overspend, Sheet untouched. **Not enabled; out of scope.**

Idempotency = `credit_ledger.source_entry_id` UNIQUE (`LDG-<uuid>` for new
writes; original `Entry_ID` or a deterministic `SHEET-<i>-<sha1…>` on backfill).
Migration runner `src/db/migrate.mjs` (forward-only, naive `;`-split, no
advisory lock); backfill `src/db/backfill-credits.mjs` (idempotent, exits
non-zero on sum mismatch — the template for future parity scripts).

## 3. Google Sheets dependency inventory

Legend — Critical? = on a user-facing or money/decision path.

### Roles / requisitions

| Area | Sheet / Tab | Read | Write | Critical? | Current caller | Migration risk |
|---|---|---|---|---|---|---|
| Role list / detail | `Role_Requests` (`A1:ZZ`, header-name mapped) | ✅ | — | ✅ | `getRoleRequests`, `getRoleRequestById` → most role/applicant/dashboard routes | Med — read-heavy whole-tab scan; dedupe only in read model |
| Role create (draft + submit) | `Role_Requests` | ✅ | append + rename | ✅ | `appendRoleRequestDraft`; `POST /api/roles`; n8n `role-request-foundation` **appends the authoritative row** | High — dual writer (portal + n8n); `DRAFT-<uuid>` → `CODE##` rename; auto-adds header columns |
| Role field edits | `Role_Requests` | ✅ | per-cell `{col}{row}` batchUpdate; `appendDimension` for new headers | ✅ | `updateRoleRequestFields` (status route, recruitment-setup route, availability route, edit route) | **High — row-number + column-letter coupling; silent schema drift** |
| Role delete | `Role_Requests` | ✅ | `deleteDimension` ROWS (physical index + `sheetId`) | ✅ | `deleteRoleRequest` | High — structural row delete |
| Recruitment setup (same row) | `Role_Requests` (~40 setup columns) | ✅ | per-cell writes ×3 + `Interview_Slots` append on publish | ✅ | `POST /api/roles/[roleId]/recruitment-setup`; n8n writes `AI_System_Prompt`, `VAPI_Resolved_System_Prompt`, `Evaluation_Fields`, venue, voice-availability | High — dual writer; JSON blobs in cells; template overwrite hazard (KNOWN-ISSUES #1) |
| Role status history | `Role_Status_History` (`A1:O`) | ✅ | — (portal reads; **n8n appends**) | ✅ | `getRoleStatusHistory`; idempotency via `Action_Request_ID` | Med — audit/history; n8n-owned writer |
| Templates | `Recruitment_Templates` (`A:G`, `Setup_JSON` blob) | ✅ | upsert / `values.clear` by row | Med | `/api/recruitment-templates` | Low — portal-only, small |
| Role→folder map | `Bulk_Role_Folder_Map` | — | — | Med | **n8n only** (`jd-role-folder-bulk-resume-screening`) | Low — reference config, single reader |

### Applicants / applications

| Area | Sheet / Tab | Read | Write | Critical? | Current caller | Migration risk |
|---|---|---|---|---|---|---|
| Applicant master + per-stage state | `High_Match_Profile` (`A:CZ`) | ✅ | per-cell writes | ✅ | `getApplicants`, `getApplicantById`, `updateApplicantProfile`, `recordApplicantDecision`; **n8n appends the row + writes AI screening result**; Vapi/final workflows write status | **Critical — dual/triple writer; no person entity; ~5 parallel status columns drift** |
| Application create | `High_Match_Profile` | ✅ | append (by n8n) | ✅ | `POST /api/public/applications` (invite-gated), `POST /api/applicants` (HR), bulk intake | High — n8n is the writer; 60s synchronous screening on the public path |
| Applicant delete (cascade) | `High_Match_Profile` + `Interview_Slots` + `Candidate_Status_History` + `Voice_Interview_Results` + `Voice_Call_Logs` + `Final_Interview_Tracking` + `Voice_Call_Queue` | ✅ | multi-tab `deleteDimension` ROWS + Calendar event delete | ✅ | `deleteApplicant` | **Critical — 7-tab structural cascade by physical row index** |
| Candidate status history | `Candidate_Status_History` (`A1:M`) | ✅ (fresh) | append | ✅ | `recordApplicantDecision`, `markInterviewNoShow`, `syncPastBookedInterviewsNoShow` | Med — audit/history |
| Screening invitations | `Resume_Screening_Invitations` (`A:N`) | ✅ | append + `Status`/`Used_At` cell write by row | ✅ | `/api/roles/[roleId]/resume-screening/invite`, `/api/public/resume-screening-invite/[token]` | Med — single-use token state; row-number write |

### Screening queue / results

| Area | Sheet / Tab | Read | Write | Critical? | Current caller | Migration risk |
|---|---|---|---|---|---|---|
| Bulk screening queue | `Bulk_Resume_Queue` (`A:U`, append-only events, latest-by-timestamp per `role|driveFileId`) | ✅ (fresh) | append | ✅ | `intakeResumeBatch`, `getBulkResumeQueue(Totals)`; **n8n Drive poller `appendOrUpdate` on `jobId`** for `Processing`/`Screened`/`Failed` | **High — dual writer; append races; in-process lock only; `Screened` terminal per role** |
| Screening evidence cross-check | `High_Match_Profile` (bulk spreadsheet) | ✅ (fresh) | — | ✅ | `getBulkResumeScreeningEvidence` — verifies n8n "Screened" claims | Med — read model logic to preserve |
| Text extraction callback | — | — | — | ✅ | `/api/resume-screening/bulk/extract` (called *by* n8n) | Low — stateless |

### Credits / ledger

| Area | Sheet / Tab | Read | Write | Critical? | Current caller | Migration risk |
|---|---|---|---|---|---|---|
| Ella Credits ledger | `Ella_Credit_Ledger` (`A:L`, append-only) **+ Postgres `credit_ledger`/`credit_balance` (dual)** | ✅ | append (+ PG mirror) | ✅ money | `recordDeduction` (cv_analysis 1, phone_interview 10), `recordTopUp`, `getCreditBalance` | **Lowest — already migrated; the reference pattern** |
| Credit pricing knobs | `Settings` | ✅ | — | Med | `getCreditPricing` (discount threshold/percent) | Low |

### Voice interview queue / logs / results

| Area | Sheet / Tab | Read | Write | Critical? | Current caller | Migration risk |
|---|---|---|---|---|---|---|
| Voice dial queue | `Voice_Call_Queue` (`A:X`) | ✅ (fresh) | append + cancel-prior + status cell writes | ✅ | `reserveBooking`, `markInterviewNoShow`, `syncPastBookedInterviewsNoShow`; **Vapi workflow reads it and writes call-progress/`Completed`** | **High — dual writer (portal + external Vapi); retry attempt state machine; in-process lock** |
| Voice capacity queue | `Interview_Slots` voice rows (≤10 concurrent per UTC interval) | ✅ (fresh) | append capacity row after each booking | ✅ | `voice-interview-capacity.ts`, `reserveBooking` (`withReservationLock("voice-capacity")`) | **Critical — Sheet-as-semaphore; single global in-process lock; not multi-instance safe** |
| Voice results / transcript | `Voice_Interview_Results` (`A:AF`), `Voice_Call_Logs` (`A:AD`) | ✅ | — (**Vapi/n8n write only**) | ✅ | `getApplicantById`, `getBookingContext`; latest row per `Application_ID` | High — external-only writer; retries add rows; per-eval-field columns by `key` |
| Booking tokens (voice) | `High_Match_Profile` (`Booking_Token*`) | ✅ | cell writes by row | ✅ | `getBookingContext`, `reserveBooking` | Med — single-use link state; No-Show reuse exception |

### Final / F2F interview tracking

| Area | Sheet / Tab | Read | Write | Critical? | Current caller | Migration risk |
|---|---|---|---|---|---|---|
| Interview slots (final rows) | `Interview_Slots` (`A:X`, `Interview_Type="Final Interview"`) | ✅ | append + cell writes + `deleteDimension` | ✅ | `reserveBooking(final)`, sync jobs, `deleteApplicant` | High — row-number coupling; calendar-event lifecycle columns |
| Final interview tracking | `Final_Interview_Tracking` (`A:AE`) | ✅ | upsert by `Application_ID` (row-number) | ✅ | `syncFinalTrackingBooking`, `upsertFinalTracking`, `recordApplicantDecision(final)` | Med — portal-owned; duplicate of `High_Match_Profile` final-* columns |
| Calendar availability / conflict | Google Calendar (not Sheets) + `Interview_Slots` `Blocked` sync | ✅ | slot `Blocked` cell writes | ✅ | `/api/bookings/calendar-busy`, `checkCalendarAvailability`, `reserveBooking(final)` | Med — external system; keep as-is, just re-point the slot store |
| Final booking token | `High_Match_Profile` (`Final_Interview_Booking_Token*`) | ✅ | cell writes by row | ✅ | `recordApplicantDecision(voice→approve)`, `getBookingContext` | Med |

### High match profiles

Not a separate concept — `High_Match_Profile` **is** the applicant/application
tab (see Applicants). There is a second `High_Match_Profile` in the bulk
spreadsheet used by the Drive poller for dedupe and by
`getBulkResumeScreeningEvidence`.

### Notifications / status fields

| Area | Sheet / Tab | Read | Write | Critical? | Current caller | Migration risk |
|---|---|---|---|---|---|---|
| Role notification outcome | `Role_Status_History.Notification_Status` / `Notification_Error` (also seeded on `Role_Requests`) | ✅ | — (**n8n writes** after resolving recipients + sending) | Med | `getRoleStatusHistory`; `src/lib/notification-status.ts` (presentation only) | Low — presentational; portal never sends mail |
| Candidate-side notifications | none — no columns; n8n sends candidate/HR emails as workflow side-effects | — | — | Med | — | Low — "notification failure must not fail the core workflow" (URS #1) |
| New-applicant watermark | browser `localStorage` `mclink.applicants.lastSeen.<email>` | client | client | Low | `new-applicants.ts`, `/api/applicants/recent` | Low — per-device, documented pilot limitation |

### Miscellaneous config / reference

| Area | Sheet / Tab | Read | Write | Critical? | Current caller | Migration risk |
|---|---|---|---|---|---|---|
| Auth / RBAC directory | `User_Directory` (`A2:K`, **positional columns**) | ✅ (hottest read — per request) | upsert / update by row | ✅ auth | `findDirectoryUser` (`/api/auth/google` every request), `/api/user-directory` | **High — auth on every request; positional (not header-mapped); legacy <10-col rows** |
| Portal / infra settings | `Settings` (`A1:F`, banner row 1, header row 2) | ✅ | append / block overwrite by row | ✅ | `getPortalSettings` → `portal-config.ts`; `/api/settings` | Med — env fallback chain; row-number block write |
| Calendar OAuth tokens | `Calendar_Connections` (`A1:G`, AES-256-GCM encrypted) | ✅ | upsert / `values.clear` by row | ✅ | `calendar-tokens.ts`, `/api/auth/google-calendar/*` | Med — secrets at rest; per-HR-user row; "Phase 2 → Postgres" already planned |
| Drive OAuth tokens | `Drive_Connections` | ✅ | upsert / clear by row | ✅ | `drive-tokens.ts`, `/api/auth/google-drive/*` | Med — as above |
| OneDrive OAuth tokens | `Microsoft_Drive_Connections` | ✅ | upsert / clear by row | Low (feature deferred) | `microsoft-drive-tokens.ts` | Low — feature not live |
| Optional `Role_AI_Settings` | documented, **no code reference** | — | — | — | — | None — legacy/unused; do not migrate |

### Structural facts to carry into the plan

- **Row-number / structural-delete coupling:** `upsertDirectoryUser`,
  `updateDirectoryUser`, `updateRoleRequestFields`, `deleteRoleRequest`,
  `upsertPortalSettings`, `upsertRecruitmentTemplate`,
  `deleteRecruitmentTemplate`, `reserveBooking`, `updateApplicantProfile`,
  `markInterviewNoShow`, `recordApplicantDecision`, `syncFinalTrackingBooking`,
  `syncPast*`, `markResumeScreeningInvitationUsed`, `save*Connection` /
  `delete*Connection`, and the 7-tab `deleteApplicant` cascade.
- **Sheets as queue/workflow state:** `Interview_Slots` (capacity semaphore +
  booking lifecycle), `Voice_Call_Queue`, `Bulk_Resume_Queue`,
  `High_Match_Profile` status columns, `Role_Requests.Status` /
  `Recruitment_Setup_Status`, booking-token status, invitation status.
- **Sheets as audit/history:** `Role_Status_History`, `Candidate_Status_History`,
  `Ella_Credit_Ledger`, plus de-facto history via append-only rows in
  `Voice_Call_Queue`, `Bulk_Resume_Queue`, `Voice_Interview_Results`.
- **n8n writes back to Sheets:** `Role_Requests` (row append + `Status` +
  `Posted_At` + `Notification_Status`), `Role_Status_History` (append),
  `High_Match_Profile` (row append + AI screening result + voice/final status),
  `Voice_Interview_Results` / `Voice_Call_Logs` (Vapi), `Voice_Call_Queue`
  (Vapi call progress), `Bulk_Resume_Queue` (Drive poller `appendOrUpdate`).
- **Formulas:** none stored. `Balance_After` is a stored computed value, never
  trusted on read. Binary content is never in Sheets (Drive only).

## 4. Existing Postgres state

### Schema (entire — reconstructed from `drizzle/0001_init_credit_ledger.sql`)

```sql
CREATE TABLE "_migrations" (          -- created by src/db/migrate.mjs
  "name" text PRIMARY KEY,
  "applied_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "credit_ledger" (        -- immutable append-only audit trail
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entry_time" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "type" text NOT NULL,               -- 'TopUp' | 'Deduction'  (free text)
  "event" text NOT NULL,              -- manual_topup|manual_adjustment|volume_discount|cv_analysis|phone_interview (free text)
  "units" integer NOT NULL,
  "credits_delta" integer NOT NULL,   -- signed
  "balance_after" integer NOT NULL,   -- true running balance here (from CTE)
  "reference" text NOT NULL DEFAULT '',
  "role_id" text NOT NULL DEFAULT '', -- un-constrained; empty-string-as-null
  "actor_name" text NOT NULL DEFAULT '',
  "actor_email" text NOT NULL DEFAULT '',
  "note" text NOT NULL DEFAULT '',
  "source_entry_id" text UNIQUE       -- nullable; idempotency key
);
CREATE INDEX "credit_ledger_entry_time_idx" ON "credit_ledger" ("entry_time");

CREATE TABLE "credit_balance" (       -- single row, id = 1
  "id" integer PRIMARY KEY,
  "balance" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
INSERT INTO "credit_balance" (id, balance) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
```

### Query layer

- Drizzle ORM `^0.45.2` + `@neondatabase/serverless` `^1.1.0`, **`neon-http`
  driver** (stateless fetch per query, no pool). No `drizzle-kit`, no `pg`, no
  `drizzle.config.*`, no `vercel.json`.
- `src/db/client.ts`: lazy module-cached client; nothing connects at import;
  `next build` + `CREDITS_BACKEND=sheets` work with `DATABASE_URL` unset.
- Writes: **one atomic CTE** (`with existed … , moved as (UPDATE credit_balance
  …), inserted as (INSERT INTO credit_ledger … FROM moved) select …`). Guard
  clause `and balance + delta >= 0` when `guard:true`. Balance and audit row can
  never disagree.
- `_migrations` runner: forward-only, filename-sorted, `sql.transaction([...])`
  per file, naive `;`-split (breaks on functions / `DO $$` / dollar-quoting),
  **no advisory lock** (two concurrent runs race), no checksums, no down.

### Dual-write + divergence (verbatim behaviour)

```
append(entry): if backend==postgres -> atomic CTE, return.
               else: Sheet append (authoritative) -> if dual: mirrorToPostgres(entry) best-effort
mirrorToPostgres: appendPostgresLedgerEntry(entry,{guard:false}); on throw ->
                  console.error("[Credits] Postgres mirror write failed…"); swallow. No retry/queue.
getCreditBalance({fresh}): if dual && fresh -> void getPostgresCreditBalance()
                  .then(pg => pg.balance!==sheet && console.error("[Credits] Divergence…"))
```

- Mirror uses `entry_time = now()` (CTE hard-codes it), not the Sheet timestamp
  — mirrored rows differ slightly in `entry_time` from backfilled rows. Cosmetic
  now; a caution for any future "compare by timestamp".
- No automatic remediation on divergence — log only; operator re-runs
  `db:backfill:credits` (idempotent, sets `credit_balance` to the raw Sheet sum,
  exits non-zero on mismatch).
- Idempotency protects the *storage layer and the mirror*, not caller-level
  retries: `recordDeduction`/`recordTopUp` mint a fresh `LDG-<uuid>` per call, so
  re-invoking the operation would double-charge. `recordTopUp` with a
  volume-discount bonus is **two** `append()` calls (two transactions).

### What is safely persisted vs Sheets-only

| Classification | Data |
|---|---|
| **In Postgres (and Sheets, `dual`)** | Ella Credits ledger + balance. Last documented check: 16 rows, balance 7, 1:1 with the Sheet, every `Entry_ID` present both sides. |
| **Postgres-only** | *Nothing by design.* In `dual`, Sheets is written first. Silent mirror failure can leave Postgres *missing* rows, never ahead. |
| **Sheets-only** | The entire recruitment domain (see §3) + `User_Directory`, `Settings`, `Recruitment_Templates`, all OAuth token tabs. |

### Docs status

`PHASE-2-BACKEND-MIGRATION.md` = "COMPLETE WITH PILOT MITIGATION": Neon
foundation ✅, ledger migrated ✅ running `dual`, dual-write validated live,
divergence false-positive fixed (detector now fresh-vs-fresh, regression test
added). **Explicitly not switching to `postgres` without operator approval.**
Named next-candidate tables (portal-only, same pattern): `Calendar_Connections`,
`Resume_Screening_Invitations`, `Settings`, `Recruitment_Templates`. Later
coordinated wave: `Role_Requests`, `High_Match_Profile`, `Interview_Slots`,
`*_Status_History`, `Bulk_Resume_Queue`.

### Is the current schema a good foundation to expand?

**Infrastructure: yes, reuse it.** `neon-http` + lazy client + plain-SQL runner +
`_migrations` + idempotent atomic-CTE + backend-switch + dual-write soak
methodology are all sound and serverless-safe.

**Data model: no — it is a two-table pilot with deliberately loose typing.**
Before the domain lands: adopt `drizzle-kit`; introduce Postgres **enums** (or
lookup tables) for every status; replace `text DEFAULT ''` foreign keys with real
nullable FKs once `roles`/`users` exist; add a shared `updated_at` trigger or
Drizzle `$onUpdate`; add an **advisory lock** to the migration runner; introduce
a **pooled driver path** (`Pool` / WebSocket, or Neon `-pooler` + PgBouncer
transaction mode) for the transactional operations that today rely on in-process
locks (booking reservation, cascade delete, decision cascade); keep the
credit-ledger CTE pattern specifically for counters and status-history tables.
`credit_balance` as a hand-maintained `id=1` singleton bakes in single-org — fine
for now, note it.

## 5. Proposed normalized schema

Design principles: one entity per table; **`applicants` (person) separate from
`applications` (person→role)**; every status is a Postgres `enum`; every
timestamp `timestamptz` (naive Sheet values interpreted as `Asia/Singapore`);
every cross-reference a real FK; keep the Sheet's human IDs as `external_id`
UNIQUE for traceability and n8n idempotency; RBAC booleans preserved verbatim;
legacy Management-Approval data goes to an `archive_*` table, never a live column.

Notation: **PK** primary key, **FK** foreign key, **U** unique, **IX** index,
**◇** lifecycle/state field.

### 5.0 Schema scope — this is a target, not a day-one deliverable

The ~30 tables below are the **full normalized target**. The initial schema for
any entity group that is eventually migrated can and should be **much smaller** —
roughly **14–18 tables** — by starting child/detail tables as `jsonb` columns and
promoting them to real tables only when a query actually needs to filter, join,
or aggregate on them. Nothing here is built now (see Phase A: DDL is *drafted on
a branch*, not deployed).

**Reminder:** per the operator decisions, **no recruitment-domain entity migrates
during the pilot**. "Core" below means "required in the minimum viable schema
*when and if* that entity group is later approved for migration" — not "build
during the pilot".

| Table | Entity group | Classification | Simpler day-one option |
|---|---|---|---|
| `credit_ledger`, `credit_balance` | Credits | **Exists — unchanged** | n/a — do not touch |
| `departments` | Reference | **Core** | — (small; needed for scoping) |
| `users` | Reference | **Core** | — (auth source; RBAC parity) |
| `oauth_connections` | Reference | **Core** | — (replaces 3 token tabs) |
| `portal_settings` | Reference | **Core** | — (trivial key/value) |
| `recruitment_templates` | Reference | Optional / defer | keep on Sheets; low churn |
| `bulk_role_folders` | Reference | Optional / defer | migrate with screening, or keep on Sheets |
| `roles` | Roles | **Core** | — |
| `role_recruitment_setup` | Roles | **Core** (1:1) | start as a `setup jsonb` column on `roles`; split out later |
| `role_evaluation_fields` | Roles | Start-as-jsonb | `evaluation_fields jsonb` on the setup row until per-field querying is needed |
| `interview_availability_rules` | Roles | Start-as-jsonb | `availability_rules jsonb` on the setup row |
| `role_status_history` | Roles | **Core** | — (append-only; needed for idempotency + audit) |
| `archive_management_approval` | Roles | Start-as-jsonb | `archive jsonb` column on `roles`; a table only if it must be queried |
| `applicants` | Applicants | **Core** | — (the person entity; the whole point of the split) |
| `applicant_aliases` | Applicants | **Core** | — (needed for dedupe integrity + the merge queue) |
| `applications` | Applicants | **Core** | — |
| `application_profile` | Applicants | **Core** (1:1) | **may be merged into `applications`** as columns — a 1:1 split is hygiene, not correctness |
| `screening_invitations` | Applicants | **Core** | — (single-use token state) |
| `resume_files` | Screening | **Core** | — (metadata; bytes stay in Drive) |
| `screening_results` | Screening | **Core** (1:1) | — |
| `screening_evaluation_scores` | Screening | Start-as-jsonb | `evaluation_scores jsonb` on `screening_results` until per-field analytics is needed |
| `bulk_screening_batches` | Screening | Optional / merge | fold batch fields onto `bulk_screening_queue_items`; a batch table only when batch-level reporting is wanted |
| `bulk_screening_queue_items` | Screening | **Core** | — (the dedupe + status store) |
| `bulk_screening_queue_events` | Screening | Optional / defer | Postgres does not need the append-log the Sheet gave for free; add only if event history is required |
| `interview_slots` | Voice + Final | **Core** | — (shared by both interview types) |
| `voice_call_attempts` | Voice | **Core** | — (replaces the queue; carries the retry/no-show state machine) |
| `voice_interview_results` | Voice | **Core** | — (Vapi-written; latest-wins) |
| `voice_interview_result_scores` | Voice | Start-as-jsonb | `evaluation_scores jsonb` on `voice_interview_results` |
| `booking_tokens` | Voice + Final | **Core** | — (single-use link state; shared) |
| `final_interviews` | Final | **Core** (1:1) | could start as `final_* ` columns on `application_profile` + a slot link; a table keeps final-stage fields together |
| `application_status_history` | History | **Core** | — (append-only; audit + stage transitions) |
| `notification_deliveries` | History | Optional / defer | keep `notification_status` / `notification_error` as columns on the history rows (already modelled) |
| `applicant_view_state` | History | Optional | only if the server-side "new applicants" watermark replaces localStorage; the per-device limitation is an accepted pilot behaviour |

**Minimum viable core** if every group were migrated with the simpler options
above: `departments`, `users`, `oauth_connections`, `portal_settings`, `roles`
(+ `setup`/`archive` as jsonb), `role_status_history`, `applicants`,
`applicant_aliases`, `applications` (+ profile merged or 1:1),
`screening_invitations`, `resume_files`, `screening_results`,
`bulk_screening_queue_items`, `interview_slots`, `voice_call_attempts`,
`voice_interview_results`, `booking_tokens`, `application_status_history` — **~17
tables**, plus the 2 existing credit tables. The remaining ~11 are jsonb-first or
genuinely optional and earn a table only on evidence of a query need.

### Reference / identity

**`departments`** — first-class at last (today free text).
- PK `id` uuid
- `name` citext **U**, `active` bool ◇, `created_at` timestamptz
- Backfill: distinct case-folded `Department` strings from `User_Directory` +
  `Role_Requests` + `High_Match_Profile`; map via an operator-reviewed alias table.

**`users`** — auth + RBAC source of truth (replaces `User_Directory`).
- PK `id` uuid; `email` citext **U** (identity); `full_name`
- `access_role` text (preset label, informational); `department_id` FK→departments (nullable)
- `can_create_role`, `can_review_role`, `can_approve_role`, `can_edit_settings`,
  `can_manage_users`, `can_review_department_role` — bool NOT NULL DEFAULT false
  ◇ (**exact** current semantics: HR review/decide company-wide; Management
  approve = view + role-status only; HOD review-department read-only)
- `active` bool ◇, `created_at`, `updated_at`
- **IX** `(active)`, `(department_id)`

**`oauth_connections`** — replaces `Calendar_/Drive_/Microsoft_Drive_Connections`.
- PK `id` uuid; `user_email` citext FK→users(email); `provider` enum
  `('google_calendar','google_drive','microsoft_drive')`
- `access_token_enc` bytea, `refresh_token_enc` bytea, `token_expires_at`
  timestamptz, `scope` text, `connected_at`, `updated_at`
- **U** `(user_email, provider)` — one connection per user per provider
- Encryption unchanged (AES-256-GCM, key from `SESSION_SECRET`).

**`portal_settings`** — replaces `Settings`.
- PK `key` text; `value` text; `category` text; `description` text;
  `updated_at` timestamptz; `updated_by` text
- Env-fallback chain stays in `portal-config.ts`.

**`recruitment_templates`** — replaces `Recruitment_Templates`.
- PK `id` uuid (keep `Template_ID`); `name` text; `setup_json` jsonb;
  `source_role_id` FK→roles(id) nullable; `created_by` text; `created_at`

**`bulk_role_folders`** — replaces `Bulk_Role_Folder_Map` (n8n reference).
- PK `id` uuid; `role_id` FK→roles(id); `role_name` text; `drive_folder_id`
  text **U**; `active` bool ◇

### Roles / requisitions

**`roles`** — core requisition (replaces the identity + workflow columns of `Role_Requests`).
- PK `id` uuid; `code` text **U** nullable (`CSE01`…; null while `DRAFT-…`);
  `external_id` text **U** (the Sheet `Role_ID`/`Submission_ID` as-is)
- `title` text; `department_id` FK→departments; `request_type` enum
  `('staff_addition','staff_replacement')`; `replacement_employee` text;
  `vacancies` int; `reason` text; `target_hiring_date` date
- `status` enum `role_status` ◇ =
  `('draft','pending_hr_discussion','approved','recruitment_setup','job_posted','returned_for_revision','on_hold','rejected')`
  — **no `pending_management_approval`**
- `recruitment_setup_status` enum ◇ =
  `('draft','recruitment_ready','ready_for_publishing','published')`
- `resume_target_status` text (hold/return resume pointer)
- `requester_user_id` FK→users nullable; `requester_email` citext;
  `requester_name` text; `submitted_by_email` citext; `hr_calendar_email` citext
  (the shared HR interview calendar addr — **not** a person; today mislabelled `HOD_Email`)
- `application_link` text; `posted_at` timestamptz; `posted_by` text;
  `posting_confirmed` bool ◇
- `latest_comments` text; `approved_by` text; `approved_at` timestamptz
- `source` text; `created_at`; `updated_at`; `updated_by_email` citext
- **IX** `(status)`, `(department_id)`, `(requester_email)`, `(created_at desc)`

**`role_recruitment_setup`** — 1:1 with `roles` (the ~40 setup columns).
- PK `role_id` FK→roles(id)
- `job_description` text; `screening_criteria` text;
  `required_interview_question_1..5` text; `ai_system_prompt` text;
  `resolved_ai_system_prompt` text; `initial_interview_booking_link` text;
  `hod_interview_booking_link` text; `posting_channels` text[];
  `license_or_certificate_required` text; `keywords_to_look_for` text;
  `minimum_years_of_experience` text; `transferable_skills_accepted` text;
  `salary_or_budget_range` text; `earliest_availability_rule` text;
  `final_interview_venue` text
- readiness flags ◇: `salary_disclosure_status`,
  `experience_requirement_status`, `license_requirement_status`,
  `hod_interview_required` — enum/text per `recruitment-setup-readiness.ts`
- voice availability ◇: `voice_interview_availability_mode` enum
  `('none','manual','automatic')`, `voice_interview_slots` jsonb,
  `voice_auto_start_date` date, `voice_auto_end_date` date,
  `voice_timezone` text, `voice_slots_generated_at` timestamptz
- `updated_at`, `updated_by_name`, `updated_by_email`
- Long-tail JD fields (`job_responsibilities`, `required_skills`,
  `education_requirements`, `preferred_qualifications`, `role_expectations`,
  `salary_min/max`, `work_schedule`, `notice_period_requirement`,
  `salary_expectation_guidance`, `reporting_manager`, `work_location`,
  `employment_type`) → keep in a `legacy_role_fields jsonb` column here until a
  consumer needs them normalized.

**`role_evaluation_fields`** — the per-role screening/interview rubric (replaces `Evaluation_Fields` JSON).
- PK `id` uuid; `role_id` FK→roles(id)
- `field_key` text (`score`,`recommendation`,`strengths`,`concerns` baseline +
  catalog + `custom_*`); `label` text; `description` text;
  `is_baseline` bool; `sort_order` int
- **U** `(role_id, field_key)`

**`interview_availability_rules`** — recurring/specific virtual-slot rules (replaces `Interview_Availability_Rules` / `HOD_Availability_Slots`).
- PK `id` uuid; `role_id` FK→roles(id); `interview_type` enum
  `('voice','final')`; `rule_type` enum `('recurring','specific')`;
  `payload` jsonb (`{date|weekday,startTime,endTime,timezone}`); `active` bool ◇
- Virtual slots stay **computed**, materialised as `interview_slots` rows only on booking.

**`role_status_history`** — append-only (replaces `Role_Status_History`).
- PK `id` uuid; `role_id` FK→roles(id); `changed_at` timestamptz;
  `changed_by_name`, `changed_by_email`; `previous_status` text;
  `new_status` text; `comments` text; `action` text; `action_source` text;
  `action_request_id` text **U** (idempotency); `access_role` text;
  `department` text; `notification_status` enum
  `('sent','pending','failed','not_configured')` ◇; `notification_error` text
- **IX** `(role_id, changed_at)`

### Applicants / applications — the person/application split

**`applicants`** — the person (NEW; today conflated).
- PK `id` uuid; `primary_email` citext **U** (normalised, lowercase — the
  dedupe key); `full_name` text; `phone_e164` text; `country` text
  (`PH`/`SG`/`MY`); `first_seen_at` timestamptz; `created_at`; `updated_at`; `notes` text
- **IX** `(phone_e164)`

**`applicant_aliases`** — alternate spellings/emails/phones seen for one person.
- PK `id` uuid; `applicant_id` FK→applicants(id); `kind` enum
  `('email','name','phone')`; `value` text; `source` text; `first_seen_at`
- **U** `(kind, value)` — an alias value belongs to at most one person; conflicts
  route to a manual-merge review queue during backfill.

**`applications`** — one person's application to one role (replaces the identity
part of `High_Match_Profile`).
- PK `id` uuid; `external_id` text **U** (the Sheet `Application_ID` as-is —
  `APP-<uuid>` / `APP-<sha>` / `APP-<13digits>-<6>` / `APP-BULK-…`)
- `applicant_id` FK→applicants(id); `role_id` FK→roles(id)
- `source` enum `application_source` =
  `('direct','referral','walk_in','agency','existing_database','hr_invitation')`;
  `source_detail` text (`Public Application Page` / `HR Invitation Link` /
  `HR Manual Intake` / `Portal Bulk Upload` / `Portal Drive Import`)
- `applied_at` timestamptz ◇ (future-clamped on import); `consent_at` timestamptz
- `resume_file_id` FK→resume_files(id) nullable
- `department_snapshot` text (as applied — role dept can change)
- `current_stage` enum `application_stage` ◇ =
  `('resume_review','resume_approved','voice_booking_pending','voice_scheduled','voice_review_pending','approved_for_final','final_scheduled','final_decision_pending','passed_final','rejected','withdrawn')`
  — the **single reconciled stage** the read model computes today from ~5 columns
- `withdrawn` bool ◇; `created_at`; `updated_at`
- Reapplication policy preserved: a repeat person→role is a **new row**, same
  `applicant_id`. No unique on `(applicant_id, role_id)`.
- **IX** `(role_id)`, `(applicant_id)`, `(current_stage)`, `(applied_at desc)`,
  `(role_id, current_stage)`

**`application_profile`** — 1:1 mutable application content + HR stage decisions
(the rest of `High_Match_Profile` minus screening result).
- PK `application_id` FK→applications(id)
- `candidate_name`, `email` citext, `phone`, `preferred_mobile`,
  `applicant_country` (as-submitted snapshot; canonical identity is on `applicants`)
- `salary_expectation`, `notice_period`, `availability`, `skills_assessment`,
  `role_expectations` text
- resume stage ◇: `resume_hr_decision` enum `decision_action`
  `('approve','reject','manual_review')`, `resume_hr_decision_date`,
  `resume_hr_reviewer`, `resume_hr_comments`
- voice stage ◇: `voice_hr_decision` enum, `voice_hr_comments`,
  `voice_approval_processed` bool (n8n claim flag — portal only clears),
  `voice_scheduled_at` timestamptz, `voice_timezone`, `voice_booking_status`
- final stage ◇: `final_hr_decision` enum, `final_interview_comments`,
  `final_interview_reviewer`, `final_interview_decision_date`,
  `final_interview_venue` (snapshot), `final_scheduled_at` timestamptz
- `legacy_status` jsonb (raw pre-reconciliation status columns, kept for audit)
- `updated_at`

**`resume_files`** — metadata only; bytes stay in Google Drive.
- PK `id` uuid; `storage_ref` text **U** (the Drive fileId); `sha256` text **IX**;
  `filename`, `mime_type`, `size` int, `kind` enum `('pdf','docx','doc')`;
  `text_extracted` bool; `uploaded_at`, `expires_at` timestamptz ◇
- Reuse-by-sha256 behaviour preserved.

**`screening_results`** — one current AI screening per application (n8n-written).
- PK `id` uuid; `application_id` FK→applications(id) **U**
- `match_score` int; `recommendation` text; `summary` text; `strengths` text;
  `gaps` text; `interview_questions` text; `screened_at` timestamptz ◇;
  `raw` jsonb (full n8n payload for audit)
- **IX** `(match_score)`

**`screening_evaluation_scores`** — per-rubric-field breakdown.
- PK `id` uuid; `application_id` FK→applications(id); `field_key` text;
  `score` numeric nullable; `value` text nullable; `evidence` text
- **U** `(application_id, field_key)`

### Resume screening — bulk

**`bulk_screening_batches`** — one HR submission.
- PK `id` uuid (the `Batch_ID`); `role_id` FK→roles(id); `created_by_email`
  citext; `created_at`; `environment` text; `is_uat` bool; `file_count` int;
  `source` enum `('upload','drive','onedrive')`

**`bulk_screening_queue_items`** — current state per file (mutable row; replaces
the append-only `Bulk_Resume_Queue` event log).
- PK `id` uuid; `batch_id` FK→bulk_screening_batches(id); `role_id` FK→roles(id)
- `dedupe_key` text (`BULK-<ROLE>-<sha256>`); `resume_sha256` text;
  `drive_file_id` text; `filename`, `file_url`, `mime_type` text
- `status` enum `bulk_screening_status` ◇ =
  `('queued','processing','screened','failed','skipped')` — `screened` terminal
- `application_id` FK→applications(id) nullable; `candidate_name`,
  `candidate_email`, `preferred_mobile`, `applicant_country` text
- `error_message` text; `attempt_count` int; `discovered_at`,
  `processing_started_at`, `processed_at`, `updated_at` timestamptz
- `job_id` text (n8n matching key)
- **U** `(role_id, resume_sha256)` — enforces the (resume, role) dedupe that is
  today advisory
- **IX** `(batch_id)`, `(role_id, status)`

**`bulk_screening_queue_events`** — optional append-only transition log (retain
event history the current Sheet gives for free).
- PK `id` uuid; `queue_item_id` FK; `at` timestamptz; `from_status`,
  `to_status` text; `actor` text; `detail` jsonb

### Voice interview

**`interview_slots`** — voice + final materialised slots (replaces `Interview_Slots`).
- PK `id` uuid; `slot_code` text **U** (the `Slot_ID`); `interview_type` enum
  `('voice','final')`; `role_id` FK→roles(id)
- `starts_at` timestamptz, `ends_at` timestamptz, `timezone` text (store the
  wall-clock timezone alongside the instant)
- `status` enum `interview_slot_status` ◇ =
  `('available','booked','blocked','expired','cancelled','no_show')`
- `application_id` FK→applications(id) nullable; `candidate_name`,
  `candidate_email` text; `booked_at` timestamptz
- final-only: `interviewer_name`, `interviewer_email`, `hod_name`, `hod_email`;
  `calendar_event_id`, `calendar_event_link`, `calendar_event_status` enum,
  `calendar_event_error` text
- `created_at`, `updated_at`
- **IX** `(role_id, interview_type, status)`, `(starts_at)`, `(application_id)`
- Voice-capacity "semaphore rows" are **not** modelled as slots — capacity is a
  `COUNT(*) … WHERE status IN (active) AND tstzrange overlaps` query guarded by a
  Postgres advisory lock or `SELECT … FOR UPDATE` (replaces the in-process lock).

**`voice_call_attempts`** — one row per dial attempt (replaces `Voice_Call_Queue`).
- PK `id` uuid; `application_id` FK→applications(id); `role_id` FK→roles(id)
- `attempt_number` int; `max_attempts` int; `scheduled_at` timestamptz ◇;
  `retry_after` timestamptz
- `status` enum `voice_call_status` ◇ =
  `('scheduled','queued','calling','initiated','in_progress','completed','retry_scheduled','no_show','cancelled')`
- `outcome` enum `voice_call_outcome` nullable ◇ =
  `('completed','no_answer','busy','wrong_person','no_show','cancelled')`
  — **"wrong_person" now a first-class value** (today only an ad-hoc log string)
- `preferred_mobile`, `contact_number`, `applicant_country` text (snapshot);
  `created_at`, `updated_at`
- **IX** `(application_id)`, `(status)`, `(scheduled_at)`
- Retry/no-show lifecycle unchanged: attempts increment, `retry_after +=
  Voice_Call_Retry_Gap_Hours`, terminal `no_show` at `max_attempts`, No-Show
  reschedule reuses the original booking token.

**`voice_interview_results`** — one row per completed call (Vapi/n8n-written).
- PK `id` uuid; `application_id` FK→applications(id); `attempt_id`
  FK→voice_call_attempts(id) nullable
- `score` int; `recommendation` text; `strengths`, `concerns`, `summary` text;
  `communication_quality` text; `answer_completeness` text;
  `recommended_follow_up_questions` text; `transcript` text
- `call_status` text; `call_final_status` text; `result_received_at`,
  `call_completed_at`, `created_at` timestamptz
- `raw` jsonb
- **IX** `(application_id, created_at desc)` — "latest wins" preserved

**`voice_interview_result_scores`** — per-eval-field voice sub-scores.
- PK `id` uuid; `result_id` FK; `field_key` text; `score` numeric; `value`
  text; **U** `(result_id, field_key)`

**`booking_tokens`** — voice + final single-use links (replaces the `*_Booking_Token*` columns on `High_Match_Profile`).
- PK `id` uuid; `application_id` FK→applications(id); `kind` enum
  `('voice','final')`
- `token_hash` text **U** (sha256 — store hash only; plaintext held transiently
  in the response, not at rest going forward — during transition keep a
  nullable `token_plain` for parity, drop at Phase G)
- `status` enum `booking_token_status` ◇ =
  `('pending','used','booked','expired','revoked')`
- `expires_at` timestamptz ◇; `used_at` timestamptz; `link` text; `created_at`
- **IX** `(application_id, kind)`

### Final / F2F interview

**`final_interviews`** — 1 per application (replaces `Final_Interview_Tracking` +
the final-* duplication on `High_Match_Profile`).
- PK `application_id` FK→applications(id)
- `slot_id` FK→interview_slots(id) nullable; `venue` text; `scheduled_at`
  timestamptz ◇; `timezone` text
- `status` enum `final_interview_status` ◇ =
  `('awaiting_schedule','interview_scheduled','interview_completed','passed','rejected','no_show')`
- `hr_decision` enum `decision_action` nullable; `recommendation` text;
  `reviewer_name`, `reviewer_email` text; `decided_at` timestamptz;
  `comments` text
- `voice_score_snapshot` int; `voice_summary_snapshot` text;
  `interviewer_name`, `interviewer_email` text; `calendar_event_id` text
- `created_at`, `updated_at`

### Status / history / audit

**`application_status_history`** — append-only (replaces `Candidate_Status_History`).
- PK `id` uuid; `application_id` FK→applications(id); `role_id` FK→roles(id);
  `changed_at` timestamptz
- `stage` enum `decision_stage` `('resume','voice','final')`;
  `action` enum `('approve','reject','manual_review','no_show','completed')`
- `previous_status`, `new_status` text; `changed_by_name`, `changed_by_email`
  text; `comments`, `rejection_reason` text; `action_source` text
- **IX** `(application_id, changed_at)`

**`notification_deliveries`** — optional; centralises the n8n notification outcome
(today: two columns on history rows).
- PK `id` uuid; `subject_type` enum `('role_status','application','booking')`;
  `subject_id` uuid; `channel` enum `('email',...)`; `recipient` citext;
  `status` enum `('sent','pending','failed','not_configured')` ◇;
  `error` text; `template` text; `sent_at`, `created_at` timestamptz
- Populated via `/api/internal/notifications` callback from n8n. Until migrated,
  keep the columns on `role_status_history` (already in that table above).

**`applicant_view_state`** — OPTIONAL server-side per-user "new applicants"
watermark (replaces the localStorage-only value; the current per-device
limitation is documented as acceptable, so this is a nice-to-have, not required).
- PK `user_email` citext; `last_seen_applicants_at` timestamptz; `updated_at`

**`archive_management_approval`** — legacy Management-Approval data, imported for
history, **never read by the live workflow**.
- PK `id` uuid; `role_id` FK→roles(id); `field` text; `value` text;
  `imported_at` timestamptz. (Source columns: `Management_Comments`,
  `Pending Management Approval` status occurrences, retired action rows.)

### Credits (unchanged; forward-compat notes only)

Keep `credit_ledger` + `credit_balance` exactly as they are. **Do not** alter in
this plan. Future (separate, approved) hardening only: add nullable `role_id`
FK→roles(id), convert `type`/`event` to enums, add `application_id` /
`booking_id` typed references instead of free-text `reference`. Not part of the
recruitment migration; credits stay on `dual`.

## 6. Sheets → Postgres mapping

| Current Sheet / Field | Proposed table | Column | Transformation | Risk / Notes |
|---|---|---|---|---|
| `Role_Requests.Role_ID` / `Submission_ID` | `roles` | `external_id` (+ `code` if `^[A-Z]+\d+$`) | copy verbatim; parse `code` | duplicate rows exist → dedupe on `external_id`, keep earliest, log |
| `Role_Requests.Status` | `roles` | `status` (enum) | map strings → enum; `Pending Management Approval` → `pending_hr_discussion` **and** archive-flag | **Critical** — free-text → constrained; legacy value must not become a live enum |
| `Role_Requests.Recruitment_Setup_Status` | `roles` | `recruitment_setup_status` (enum) | `Draft/Recruitment Ready/Ready for Publishing/Published` → enum | Medium |
| `Role_Requests.Department` | `departments` + `roles.department_id` | FK | normalise case; operator alias table for typos/synonyms | **High** — free text, no entity; scoping depends on it |
| `Role_Requests.HOD_Email` | `roles` | `hr_calendar_email` | copy; **rename semantics** (it is the shared HR calendar, not a person) | Medium — misleading legacy name |
| `Role_Requests.Requester_Email/Name`, `Submitted_By_*`, `Approved_By/At`, `Latest_Comments` | `roles` | matching columns | link `requester_user_id` where email ∈ users | Low |
| `Role_Requests.Management_Comments` | `archive_management_approval` | row | archive only | do **not** surface in UI |
| `Role_Requests` recruitment-setup columns (~40) | `role_recruitment_setup` | matching | split JSON-in-cell (`Evaluation_Fields`, `Voice_Interview_Slots`, `Interview_Availability_Rules`) into rows / jsonb | **High** — JSON blobs, dynamic columns, template-overwrite hazard |
| `Role_Requests.Evaluation_Fields` / `Evaluation_Field_Toggles` | `role_evaluation_fields` | rows | `Evaluation_Field_Toggles` (comma list) is authoritative for selection; merge baseline + catalog + custom | Medium — two competing representations today |
| `Role_Requests.Interview_Availability_Rules` / `HOD_Availability_Slots` / `Voice_Interview_Slots` | `interview_availability_rules` | rows (jsonb payload) | parse JSON; keep virtual-slot computation in code | Medium |
| long-tail JD fields | `role_recruitment_setup.legacy_role_fields` | jsonb | park until a consumer needs them | Low — avoid premature normalization |
| `Role_Status_History.*` | `role_status_history` | matching | `Changed_At` text → timestamptz (`Asia/Singapore`); `Action_Request_ID` → **U** | Medium — dedupe on `action_request_id` |
| `High_Match_Profile.Application_ID` | `applications` | `external_id` | verbatim; recognise all 4 id formats | **Critical** — the join key everywhere |
| `High_Match_Profile` person fields (`Candidate_Name`, `Email`, `Phone`, `Preferred_Mobile`, `Applicant_Country`) | `applicants` (+ `applicant_aliases`) | dedupe into person | **normalise email lowercase = dedupe key**; name/phone-only matches → manual merge queue | **Critical** — no person entity today; KNOWN-ISSUES #2 name variants |
| `High_Match_Profile.Role_ID` | `applications.role_id` | FK | resolve via `roles.external_id`; orphans → quarantine table | High — referential integrity not enforced today |
| `High_Match_Profile.Date_of_Application` (+ ~6 aliases) | `applications.applied_at` | timestamptz | future-clamp (>5 min ahead → derive from `APP-<13digits>` or row order); `Asia/Singapore` for naive | **High** — legacy "local clock + Z" rows |
| `High_Match_Profile` status columns (`Status (Resume Processing)`, `Status 2`, `Status 3`, `Final_Status`) | `applications.current_stage` + `application_profile.*_hr_decision` | enum + reconcile | run the existing read-model reconciliation (`applicantStageDefinitions`) at import time to compute one `current_stage`; keep raw values in `application_profile.legacy_status jsonb` | **Critical** — 5 drifting columns → 1 truth; heavy logic to port exactly |
| `High_Match_Profile` screening result (`Match_Score`, `Recommendation`, `AI_Analysis_Summary`, `Strengths`, `Gaps`, `Interview_Questions`, per-eval-field columns) | `screening_results` + `screening_evaluation_scores` | matching | per-`key` columns → rows | High — n8n is the writer; dynamic per-role columns |
| `High_Match_Profile.Resume_File_*` | `resume_files` (+ `applications.resume_file_id`) | matching | keep Drive `storage_ref`; bytes stay in Drive | Medium |
| `High_Match_Profile.Booking_Token*` / `Final_Interview_Booking_Token*` | `booking_tokens` | rows (kind voice/final) | store `token_hash`; keep `token_plain` nullable during transition only | Medium — single-use state; No-Show reuse rule |
| `High_Match_Profile.Final_Interview_*` | `final_interviews` + `application_profile` | matching | de-duplicate against `Final_Interview_Tracking` (operator sets the conflict-winner rule) | Medium |
| `Candidate_Status_History.*` | `application_status_history` | matching | `Stage`/`Action` → enums; `Changed_At` → timestamptz | Medium |
| `Interview_Slots.*` | `interview_slots` | matching | `Date`+`Start_Time`+`Timezone` → `starts_at` timestamptz + `timezone`; `Status` → enum; **drop capacity/`VOICE-CAPACITY-*` rows** (now a query) | **High** — row-number coupling; semaphore rows; calendar columns |
| `Voice_Call_Queue.*` | `voice_call_attempts` | one row per attempt | collapse append-only events → attempt rows; `Voice_Call_Status` → enum; add `outcome` incl. `wrong_person` | **High** — dual writer (Vapi); state machine |
| `Voice_Interview_Results.*` / `Voice_Call_Logs.*` | `voice_interview_results` (+ `_result_scores`) | matching | latest-by-timestamp per application preserved; per-`key` columns → rows; `Voice_Call_Logs` merged as fallback source | High — external-only writer |
| `Final_Interview_Tracking.*` | `final_interviews` | matching | many alias columns (`Comments`/`HR_Comments`/`Decision_Comments`…) → single columns | Medium — duplication with `High_Match_Profile` |
| `Bulk_Resume_Queue.*` | `bulk_screening_batches` + `bulk_screening_queue_items` (+ `_events`) | matching | collapse events → current-state row + event log; `BULK-<ROLE>-<sha>` → `dedupe_key`; `(role, sha)` → **U** | **High** — dual writer; append races; `Screened` terminal |
| `Bulk_Role_Folder_Map.*` | `bulk_role_folders` | matching | `Active` → bool | Low — n8n reader |
| `Resume_Screening_Invitations.*` | (new) `screening_invitations` table (same shape) | matching | `Token`→hash, `Status`→enum, `Expires_At`→timestamptz | Medium — single-use; `Application_ID` back-ref |
| `Ella_Credit_Ledger.*` | `credit_ledger` / `credit_balance` | **already mapped** (backfill script) | — | Lowest — done; keep `dual` |
| `User_Directory.*` (positional A–K) | `users` (+ `departments`) | matching | **positional → named**; legacy <10-col rows: col-9 = `Active`, `Can_Manage_Users` inherits `Can_Edit_Settings`, col-K `Can_Review_Department_Role` default false | **High** — auth on every request; positional parsing; RBAC must match exactly |
| `Settings.*` (banner row 1, header row 2) | `portal_settings` | matching | drop the banner-row quirk | Medium — env-fallback chain stays in code |
| `Calendar_/Drive_/Microsoft_Drive_Connections.*` | `oauth_connections` | matching | keep AES-256-GCM ciphertext as `bytea`; `(user_email, provider)` → **U** | Medium — secrets; per-user row |
| `Recruitment_Templates.*` | `recruitment_templates` | matching | `Setup_JSON` → jsonb | Low |
| localStorage `mclink.applicants.lastSeen.*` | `applicant_view_state` (optional) | `last_seen_applicants_at` | only if the server-side watermark is adopted | Low — documented pilot limitation otherwise |
| `Optional Role_AI_Settings` | — | — | **do not migrate** (no code reads it) | None |

### Fields that should NOT be migrated as live data

- `Pending Management Approval` status, `Management_Comments`, retired
  `send_for_management_approval` / `*_management` action rows → `archive_*` only.
- `Balance_After` (credit ledger) as a source of truth — recompute; keep for audit.
- `VOICE-CAPACITY-*` / placeholder `Interview_Slots` rows → replaced by a query.
- Duplicate/aliased columns (`Contact Number` vs `Contact_Number`, the ~6
  `Date_of_Application` aliases, the 4 `Final_Interview` comment aliases) →
  collapse to one canonical column.
- Far-right columns created by past header typos (schema-drift artifacts) →
  review and drop; do not import blindly.
- `DRAFT-<uuid>` role rows that were never submitted → import as `status=draft`
  but flag for operator cleanup.

## 7. Risk register

### Critical

| ID | Risk | Detail | Mitigation |
|---|---|---|---|
| C1 | **Person/application conflation** — no candidate entity | Same person across roles/reapplications = unlinked rows; name variants (KNOWN-ISSUES #2). Backfill must invent the person layer. | Dedupe key = normalised email only; name/phone-only matches go to a **manual merge review queue**, never auto-merged. Reapplication stays a distinct `applications` row. Ship `applicants` + `applicant_aliases` before any application backfill. |
| C2 | **Credit double-deduction** during dual-write / cutover | Caller-level retries mint fresh `LDG-<uuid>`; a booking or bulk batch retried across a backend flip could charge twice. | Credits stay on `dual` for the whole recruitment migration (no `postgres` flip). Add a caller-level idempotency key (applicationId/queueId) to `recordDeduction` before any interview/screening entity cuts over. Parity script asserts ledger sum + `Entry_ID` set equality every run. |
| C3 | **Concurrent n8n + portal writes** to the same entity | `Role_Requests`, `High_Match_Profile`, `Voice_Call_Queue`, `Bulk_Resume_Queue`, `Voice_Interview_Results` all have ≥2 writers with only in-process locks. During shadow-write, a Postgres row and a Sheet row can diverge mid-flight. | Per entity: (a) shadow-write from the portal only; (b) a Sheets→PG sync worker reconciles n8n-written rows on a short interval keyed by `external_id`/`action_request_id`; (c) do not make an entity PG-primary until its n8n writer has moved to `/api/internal/*`. |
| C4 | **Structural row-delete cascade** (`deleteApplicant`, 7 tabs) | Physical row-index deletes across tabs + Calendar event; a half-done cascade under multi-instance is possible today. | Model as FK `ON DELETE CASCADE` (or soft-delete `withdrawn`/`deleted_at`) in one Postgres transaction (pooled driver). Rehearse in staging with referential fixtures. |
| C5 | **Voice-capacity semaphore** is a Sheet + a global in-process lock | `MAX_CONCURRENT_VOICE_INTERVIEWS=10` enforced by counting Sheet rows under `withReservationLock`. Multi-instance already unsafe. | Replace with `SELECT count(*) … FOR UPDATE` / `pg_advisory_xact_lock` in a real transaction when `voice_call_attempts` migrates. This is a **correctness upgrade**, not just a port. |
| C6 | **No Neon backup / PITR** while a real balance lives there | Only recovery today is "re-run backfill from the Sheet" — works only while `dual` keeps the Sheet complete. | **Phase A blocker:** enable Neon PITR (≥7d, target 30d), schedule weekly `pg_dump` to object storage, document + test a restore, state RPO/RTO. |
| C7 | **Status free-text → enum mapping** loses/merges states | ~30 distinct status strings across 5 columns; the reconciliation logic is large and defensive. | Port `applicantStageDefinitions` / `applyFinalBookingState` verbatim into a tested import function; keep raw values in `legacy_status jsonb`; parity script compares computed `current_stage` Sheets-vs-PG for every application. |

### High

| ID | Risk | Mitigation |
|---|---|---|
| H1 | Row-number / column-letter coupling throughout the write layer | Rewrite writes as keyed upserts behind a repository layer; no row indexes in Postgres. |
| H2 | Silent schema drift (typo header → new column) | Freeze Sheet schemas; add a header-allowlist check in the Sheets client during transition; log unknown headers instead of appending. |
| H3 | Append-race row loss in `Bulk_Resume_Queue` / `Voice_Call_Queue` multi-instance | `(role, sha)` and attempt-number uniqueness in PG; the queue becomes the safe store once PG-primary. |
| H4 | Missing / malformed IDs (`Role_ID` orphans, `APP-` format variants, empty `Application_ID`) | Quarantine table for unresolvable rows; operator review; never silently drop. |
| H5 | Text timestamps + timezone ("local clock + Z", Asia/Singapore assumed) | Single documented rule: naive → `Asia/Singapore`; `Z`-suffixed but future → clamp; store `timestamptz`. Parity checks every timestamp parses. |
| H6 | Booking-token references (`tokenFromBookingLink` re-derivation, No-Show reuse) | Model `booking_tokens` with explicit `status` + `kind`; port the No-Show reuse exception as an allowed transition. |
| H7 | External Vapi workflow not in the repo | Cannot migrate its writes without vendor coordination; voice entity is last and needs a documented `/api/internal/voice/*` contract + vendor sign-off. |
| H8 | `User_Directory` is auth on every request and positionally parsed | Migrate `users` early (reference data), shadow-read first, parity on every RBAC boolean, keep Sheet as fallback until proven. |

### Medium

| ID | Risk | Mitigation |
|---|---|---|
| M1 | Duplicate role rows / duplicate ledger entries | `external_id` / `source_entry_id` UNIQUE; import keeps earliest + logs. |
| M2 | Stale queue statuses (`Processing` never cleared — R1) | `reconcile` job on the PG queue; `STALE_PROCESSING_MS` rule ported. |
| M3 | `Final_Interview_Tracking` duplicates `High_Match_Profile` final-* | One canonical `final_interviews` row; operator picks the conflict-winner rule. |
| M4 | Template load overwrites live setup (KNOWN-ISSUES #1) | Out of scope to fix here, but note: `recruitment_templates` as a table makes an audit trail possible. |
| M5 | Migration runner naive `;`-split, no advisory lock | Adopt `drizzle-kit` in Phase A. |
| M6 | Per-eval-field dynamic columns (`key`-named) | Rows in `*_evaluation_scores`; import reads role's `Evaluation_Field_Toggles`. |
| M7 | Notification columns vs a deliveries table | Keep columns until n8n notification callback moves to `/api/internal/*`. |

### Low

| ID | Risk | Mitigation |
|---|---|---|
| L1 | localStorage watermark per-device | Optional `applicant_view_state`; otherwise unchanged (documented limitation). |
| L2 | `Microsoft_Drive_Connections` (feature deferred) | Migrate with the other OAuth tokens; no live traffic. |
| L3 | `Optional Role_AI_Settings` unused | Do not migrate. |
| L4 | `Balance_After` mirror uses `now()` not Sheet time | Cosmetic; parity compares on `source_entry_id`, not timestamp. |
| L5 | Demo/historical synthetic rows in lists/metrics | Import with an `is_historical_demo` flag; keep out of operational queries. |

## 8. Phased migration plan

**Sequencing rule (operator decision 2):** each entity progresses through
shadow-write → backfill → parity → shadow-read → PG-primary **independently**;
the PG-primary cutover for an entity is a separate go decision on its own
evidence. Phases C–H therefore run **per entity / per entity-group**, not as
global steps.

**Timing rule (operator decision 1):** only **Phase A** and **Phase B
observation** are approved now. **C–H are NO-GO** until pilot/UAT sign-off **and**
explicit written approval.

### Phase A — Schema preparation & infrastructure (APPROVED NOW; no behaviour change)

- **Changes:** adopt `drizzle-kit` (generate/apply/CI drift check) + add an
  advisory lock to the migration runner. Enable Neon PITR + weekly `pg_dump` to
  object storage; write & test a restore runbook; document RPO/RTO. Add a
  pooled-driver path (`src/db/pool.ts`, Neon `-pooler`/PgBouncer) for future
  transactional work, unused for now. Draft (not deploy) the enum + table DDL
  from §5 as `drizzle/0002_*.sql … 000N_*.sql` on a branch. Define the
  `/api/internal/*` service-auth design (scoped token, server-side only) as a
  written contract — no endpoints built yet. Stand up a **staging rig**: Neon
  branch + copy spreadsheet + non-prod n8n set. Build the **parity harness
  skeleton** (extends `backfill-credits.mjs`: JSON diff output, non-zero exit,
  CI wireable). Fix or at least **log** the silent-column-drift behaviour in the
  Sheets client.
- **Prerequisites:** none (all additive / off-path).
- **Validation:** `tsc`/`eslint`/tests/`build` green; `db:migrate` still a no-op
  against prod (new DDL stays on the branch); Neon restore test passes; parity
  skeleton runs green against credits.
- **Rollback:** delete the branch; `drizzle-kit` and pool module are inert
  without callers; disabling PITR is a config toggle.
- **Exit criteria:** backups tested; `drizzle-kit` + CI in place; staging rig
  usable; parity skeleton runs; `/api/internal/*` design signed off;
  schema-drift no longer silent. **No production schema or behaviour change.**

### Phase B — Credits dual-write validation (APPROVED NOW; observation only)

- **Changes:** none — `CREDITS_BACKEND` stays `dual`. Add the caller-level
  idempotency key to `recordDeduction`/`recordTopUp` (C2) as the *only* code
  change, behind tests, no behaviour change in the happy path.
- **Validation:** a fresh **24–48 h `dual` window with zero `[Credits]
  Divergence` and zero `Postgres mirror write failed`** in Vercel logs (the
  detector fix is already deployed); `db:backfill:credits` compare clean; Neon
  `credit_balance` == Sheet ledger sum == Neon ledger sum; `Entry_ID` sets equal.
- **Rollback:** `CREDITS_BACKEND=sheets`, redeploy (documented).
- **Exit criteria:** the clean soak window is recorded in
  `RELEASE-VALIDATION-STATUS.md`. **Credits remain on `dual`** — a `postgres`
  cutover is a *separate future decision*, explicitly out of this plan.

### Phase C — Shadow-write recruitment records (NO-GO until approved)

- **Per entity, in the §12 order.** Introduce a repository layer
  (`src/lib/repositories/<entity>.ts`) that the portal calls; behind a flag
  `SHADOW_WRITE_PG.<entity>` it writes Postgres **after** the authoritative Sheet
  write (mirror pattern, best-effort, logged — same shape as credits). A
  **Sheets→PG sync worker** (Vercel Cron) reconciles n8n-written rows for that
  entity by `external_id` / `action_request_id`.
- **Prerequisites:** Phase A complete; that entity's DDL migrated to prod (empty
  tables); operator approval; the entity's read model logic ported into a tested
  import/reconcile function.
- **Validation:** for N days, every portal write appears in PG within the sync
  window; `parity:<entity>` diff shrinks toward zero; no new error-log classes.
- **Rollback:** set `SHADOW_WRITE_PG.<entity>=false`; stop the sync worker.
  Sheets untouched and authoritative throughout; PG holds partial data — discard
  (truncate) or keep, harmless.
- **Exit criteria:** ≥7 days of shadow-write with parity drift only from
  known-stale historical rows.

### Phase D — Backfill historical data (NO-GO until approved; per entity)

- **Changes:** one-time idempotent backfill scripts per entity
  (`src/db/backfill-<entity>.mjs`, `ON CONFLICT (external_id) DO NOTHING`
  pattern), run from an operator machine against prod `DATABASE_URL`. Applies the
  data-cleanup rules: person dedupe (email) + manual-merge queue, phone
  normalisation, status→enum mapping, timestamp rule, orphan quarantine,
  Management-Approval → `archive_*`.
- **Prerequisites:** Phase C stable for the entity; cleanup rules signed off;
  the manual-merge queue tooling exists; staging rehearsal done.
- **Validation:** script prints counts (sheet rows / inserted / skipped /
  quarantined) and **exits non-zero on any unresolved orphan or count
  mismatch**; `parity:<entity>` full run clean except the documented manual-merge
  set.
- **Rollback:** `TRUNCATE` the entity's tables (additive, no Sheet impact);
  re-run later. Backfill is re-runnable.
- **Exit criteria:** historical + live rows present in PG; quarantine + merge
  queues emptied or explicitly accepted by the operator.

### Phase E — Read comparison / shadow reads (NO-GO until approved; per entity)

- **Changes:** the repository layer, behind `SHADOW_READ_PG.<entity>`, reads
  **both** stores on each request, returns the **Sheet** result, and logs
  structured diffs (field-level) to a `parity_mismatch` table / log drain.
- **Prerequisites:** Phase D complete for the entity.
- **Validation:** mismatch rate over a rolling window falls below an agreed
  threshold (target: 0 for IDs/status/ownership/relationships; small, explained
  set for free-text/whitespace). A dashboard shows the trend.
- **Rollback:** flip the flag off — pure read-side, no data risk.
- **Exit criteria:** ≥14 days (covering a full recruitment cycle for that
  entity) below threshold; every residual mismatch class documented.

### Phase F — Postgres read-primary (NO-GO until approved; per entity go decision)

- **Changes:** `READ_SOURCE.<entity> = postgres`. The portal **still writes
  Sheets** (mirror) for fallback + reporting + as the n8n contract. n8n still
  writes Sheets; the sync worker still runs.
- **Prerequisites:** Phase E exit for the entity; rollback runbook reviewed;
  on-call aware.
- **Validation:** functional smoke of every screen/route touching the entity;
  p95 latency ≤ the Sheets baseline; error rate flat; a scheduled parity job
  still green (now PG-authoritative vs Sheet-mirror).
- **Rollback:** `READ_SOURCE.<entity> = sheets`. Because Sheets is still fully
  written, it is current — **no data loss, no reconciliation needed.**
- **Exit criteria:** ≥14 days read-primary, parity green, no rollback triggered.

### Phase G — Postgres source of truth (NO-GO until approved; per entity)

- **Changes:** the entity's **n8n / Vapi writer moves to `/api/internal/*`**
  (portal validates + writes PG, then mirrors to Sheets during a bake period).
  Portal writes PG first (authoritative); Sheet write becomes a best-effort
  mirror. The Sheets→PG sync worker for that entity is retired.
- **Prerequisites:** Phase F exit; the internal endpoint built, tested, and the
  n8n workflow / Vapi vendor cut over in staging; a **PG→Sheets mirror writer**
  running so Sheets stays reconstructable during the bake.
- **Validation:** end-to-end through the real n8n path in staging then prod;
  idempotency verified (replayed webhook = no-op); PG→Sheets mirror keeps the
  Sheet within the bake tolerance.
- **Rollback (the dangerous one — see §11):** revert `READ_SOURCE` + writer flags
  to Sheets; run a **final PG→Sheets reconciliation job** for anything written to
  PG after the last mirror tick. Keep the mirror writer running until the bake
  proves zero drift. **A reconciliation job is mandatory for G rollback.**
- **Exit criteria:** ≥30 days PG-primary for that entity, PG→Sheets mirror drift
  zero, no rollback.

### Phase H — Sheets reporting / export only (NO-GO until approved; after all target entities at G)

- **Changes:** replace the PG→Sheets mirror with a scheduled **reporting export**
  (denormalised, read-optimised tabs for HR analytics). Retire the operational
  Sheet writers and the mirror. Sheets is no longer on any read/write critical
  path.
- **Prerequisites:** every entity the operator chose for PG-primary is past
  Phase G exit; HR sign-off on the export format.
- **Validation:** export job runs on schedule; HR confirms their reports still
  work; a "kill Sheets writes" test in staging shows the portal fully functional.
- **Rollback:** re-enable the mirror writer (kept in code, dormant) → back to
  Phase G posture.
- **Exit criteria:** operational Sheet writes gone; only the export remains;
  documented.

### Adjustment vs the requested A–H

Same spine. Differences the code forced: **B is observation-only and credits stay
`dual`** (no C-style flip); **C–G are per-entity, not global**; a **Sheets→PG
sync worker** is required in C–F because n8n writes Sheets; **G is gated on the
n8n/Vapi `/api/internal/*` cutover** and needs a PG→Sheets mirror + a
reconciliation job for rollback; reference data (`users`, `departments`,
settings, OAuth tokens) goes first because it is low-churn and mostly
portal-only.

## 9. n8n migration impact

**No live n8n workflow is touched by this plan.** This is the change map for
later phases.

| Workflow (repo ref) | Current Sheets dependency | Future Postgres dependency | Independent? | Idempotency | Retry | Likely order |
|---|---|---|---|---|---|---|
| `role-request-foundation.json` (role created / status / recruitment setup / bulk-batch-complete) | **Appends `Role_Requests`**, appends `Role_Status_History`, writes `Status`/`Posted_At`/`Notification_Status` | `POST /api/internal/roles` + `/api/internal/roles/{id}/status` — portal writes `roles` / `role_status_history` | Yes, once `roles` is at Phase F | `action_request_id` (already sent) → upsert; `role_status_history.action_request_id` **U** | Safe to retry (idempotent upsert) | **1st** (after reference data) |
| `ai-role-description-parser.ts` | None | None | Yes | n/a | n/a | Any time — no change |
| `candidate-application-foundation.json` (AI CV screening) | **Appends `High_Match_Profile`**, writes `Match_Score`/`Recommendation`/`Resume_HR_Decision`/`Resume_File_*` | `POST /api/internal/applications` (create) + `/api/internal/applications/{id}/screening` (result) — portal writes `applications`/`application_profile`/`screening_results`/`screening_evaluation_scores` | Yes, once applications + screening at Phase F | `X-Idempotency-Key` (already sent) | Retry-safe via upsert on `external_id` | **2nd** (highest volume; needs applicants first) |
| `application-invite-email.json` | None (reads `Role_Requests`/`User_Directory` to resolve recipients; returns `notificationStatus`) | Optional `POST /api/internal/notifications` to record delivery | Yes — fully independent | delivery id | best-effort | Any time (low priority) |
| `bulk-resume-upload-intake.ts` | Reads/appends `Bulk_Resume_Queue` | `POST /api/internal/bulk/queue-events` | With screening | `queueId` / `jobId` | Retry-safe (status upsert) | **3rd** (with screening) |
| `jd-role-folder-bulk-resume-screening.ts` (Drive poller) | Reads `Bulk_Role_Folder_Map` + `Bulk_Resume_Queue` + `High_Match_Profile` (dedupe); `appendOrUpdate` `Bulk_Resume_Queue` | `GET /api/internal/bulk/role-folders` + `GET /api/internal/bulk/dedupe?role&sha` + `POST /api/internal/bulk/queue-events` | With screening | `jobId`; `(role, sha)` **U** in PG | Retry-safe | **3rd** (with screening) |
| Vapi voice calling + results (**external, not in repo**) | Reads `Voice_Call_Queue`; writes `Voice_Interview_Results` / `Voice_Call_Logs` / `Voice_Call_Queue` status | `GET /api/internal/voice/queue` + `POST /api/internal/voice/attempts/{id}` + `POST /api/internal/voice/results` | Only after voice entity at Phase F **and** vendor coordination | needs an explicit `attempt_id` in the contract (today implicit) | Must be idempotent on `attempt_id` + result dedup | **Last** — highest risk, external dependency |

**General n8n cutover rule:** a workflow moves to `/api/internal/*` **only when
its entity is at Phase G**. Until then it keeps writing Sheets and the sync
worker mirrors those writes into Postgres. Each endpoint enforces the service
token, validates against the Zod schema, maps to enums, applies the idempotency
key, and writes in one transaction. **n8n and Vapi never get direct Postgres
credentials or a direct DB connection** — the portal's internal service API is
the only write path, so validation, idempotency, status rules, RBAC-free service
auth, and logging stay in one place.

## 10. Parity / validation plan

Build on `src/db/backfill-credits.mjs`: each script reads both stores, emits a
**machine-readable JSON diff**, **exits non-zero on any mismatch in a "must
match" class**, and is runnable on-demand + in CI (against staging) + scheduled
(against prod, read-only).

| Script | Checks | Must-match (exit non-zero) |
|---|---|---|
| `parity:counts` | row/entity counts per table vs its Sheet tab (excluding `is_historical_demo`, quarantined) | count delta = 0 (± documented stale set) |
| `parity:roles` | every `Role_ID` present both sides; `status`, `recruitment_setup_status`, `code`, `department` resolve; requester email | IDs, status, ownership |
| `parity:applicants` | no PG applicant with 0 applications; `primary_email` unique; alias values map to exactly one person; manual-merge queue size | email uniqueness, alias integrity |
| `parity:applications` | every `Application_ID` both sides; `applicant_id` + `role_id` resolve; `current_stage` (computed both sides) equal; `source` equal; `applied_at` within tolerance | IDs, stage, ownership, role link |
| `parity:screening` | one `screening_results` per screened application; `match_score` + `recommendation` equal; per-eval-field score rows match column values | score, recommendation |
| `parity:bulk-queue` | current status per `(role, sha)` equal; `Screened` terminal respected; no duplicate `(role, sha)` | status, uniqueness |
| `parity:interviews` | slot count; every `Booked` slot ↔ an application; `starts_at` equals `Date`+`Start_Time`+`Timezone`; `calendar_event_id` present where Sheet has one | booking linkage, instant equality |
| `parity:voice` | attempts reconstructable from queue events; latest `voice_interview_results` per application equal on `score`/`recommendation`; transcript non-empty where `call_completed_at` set; `outcome` mapping (incl. `wrong_person`) | latest result, score validity |
| `parity:final` | one `final_interviews` per application with final activity; `status`, `hr_decision`, `venue` equal; slot link | status, decision |
| `parity:history` | `role_status_history` + `application_status_history` counts; `action_request_id` / event uniqueness; chronological order; no gap in stage transitions | uniqueness, count |
| `parity:credits` (extend existing) | `credit_balance` == Sheet ledger sum == PG ledger sum; `Entry_ID`/`source_entry_id` **set equality**; no duplicate; `Balance_After` running-sum reconstruction | balance, set equality, no dup |
| `parity:users` | every active `User_Directory` row → a `users` row; **every RBAC boolean equal**; `department` resolves | every permission bit, active flag |
| `parity:timestamps` | every migrated timestamp column parses; none > now + tolerance; timezone rule applied consistently | parse success |
| `parity:orphans` | quarantine table empty or operator-accepted; no FK target missing | quarantine size |

Scheduled prod run posts a summary to the ops channel; any non-zero exit pages.
A **cutover for an entity requires its `parity:<entity>` green for the full
Phase E window.**

## 11. Rollback plan

**Invariant:** never allow a state where a write goes **only** to Postgres and
the Sheet cannot be reconstructed — until that entity has passed Phase F (Sheets
still fully written) and a PG→Sheets mirror is running for Phase G.

| Phase | Revert to Sheets | Avoid losing writes | Postgres-only writes | Reconciliation job? |
|---|---|---|---|---|
| A | n/a (no behaviour change) | n/a | none | No |
| B | `CREDITS_BACKEND=sheets`, redeploy | Sheets always authoritative | none (mirror only) | No — re-run `db:backfill:credits` compare if paranoid |
| C | `SHADOW_WRITE_PG.<entity>=false`; stop sync worker | Sheets authoritative throughout | none | No — `TRUNCATE` PG entity tables |
| D | `TRUNCATE` PG entity tables; re-run backfill later | Sheets untouched | none | No |
| E | flip `SHADOW_READ_PG.<entity>=false` | read-only comparison, no writes | none | No |
| F | `READ_SOURCE.<entity>=sheets` | **Sheets still fully written → current, nothing lost** | none | No |
| G | revert `READ_SOURCE` + writer flags to Sheets; **run final PG→Sheets reconcile** for rows written after the last mirror tick; keep mirror writer running | PG→Sheets mirror + final reconcile | **Yes — anything between last mirror tick and rollback** | **Yes — mandatory** |
| H | re-enable the dormant PG→Sheets mirror writer → back to G posture | mirror catches up | as in G | Yes (the mirror is the reconciliation) |

**G/H rollback runbook (the only risky ones):**
1. Set the entity's `READ_SOURCE` and n8n writer target back to Sheets.
2. Run `reconcile:pg-to-sheets --entity <e> --since <last-mirror-tick>` — appends/
   updates Sheet rows for every PG change not yet mirrored, keyed by `external_id`.
3. Run `parity:<entity>` — must be green before declaring rollback complete.
4. Leave the PG→Sheets mirror running until root cause is fixed; re-attempt G
   later. Do **not** remove Sheet writers or the mirror until ≥30 days clean.

Rollback drills are rehearsed in the Phase A staging rig before C begins for each
entity.

## 12. Recommended migration order

Dependency-graph derived (reference data → owning entities → dependent entities →
history → external writers):

0. **Phase A infra** (drizzle-kit, Neon backups, pooled driver, staging rig,
   parity harness, `/api/internal/*` design, schema-drift fix) — **now**.
1. **Credits** — finish the Phase B zero-divergence soak. **Stays on `dual`.**
   (~90% done; observation only.)
2. **Reference data** — `departments`, `users` (+ RBAC parity),
   `portal_settings`, `oauth_connections`, `recruitment_templates`,
   `bulk_role_folders`. Low churn, mostly portal-only, no n8n write contention.
   Gets a real `users` auth source and `departments` entity in place early.
3. **Roles / requisitions** — `roles`, `role_recruitment_setup`,
   `role_evaluation_fields`, `interview_availability_rules`,
   `role_status_history`. n8n co-writer (`role-request-foundation`) → sync worker
   during transition, `/api/internal/roles` at G.
4. **Applicants + Applications** — `applicants`, `applicant_aliases`,
   `applications`, `application_profile`, `screening_invitations`. The
   person/application split + dedupe backfill. n8n co-writer
   (`candidate-application-foundation`).
5. **Resume screening** — `resume_files`, `screening_results`,
   `screening_evaluation_scores`, `bulk_screening_batches`,
   `bulk_screening_queue_items` (+ events). n8n bulk workflows.
6. **Voice interview** — `interview_slots` (voice), `voice_call_attempts`,
   `voice_interview_results` (+ scores), `booking_tokens` (voice). Capacity
   semaphore → DB lock. **External Vapi coordination required for G.**
7. **Final / F2F interview** — `interview_slots` (final), `final_interviews`,
   `booking_tokens` (final). Calendar integration unchanged; mostly
   portal-owned.
8. **History / notifications** — `application_status_history` (if not already
   carried with applications), `notification_deliveries`, optional
   `applicant_view_state`.
9. **Sheets → reporting/export only** (Phase H) — after every operator-chosen
   entity is past Phase G; stand up the denormalised export; retire operational
   Sheet writers.

Each of 2–8 runs its own C→D→E→F→G with an independent go decision at F and G.

## 13. Exact prerequisites before we start coding

1. **Written operator GO** for the target end-state (per-entity PG-primary) and
   confirmation that **credits stay on `dual`** for the entire recruitment
   migration (a `credits → postgres` cutover is a separate later decision).
2. **Neon backups:** PITR enabled (≥7 days, target 30), weekly `pg_dump` to
   object storage, a **tested restore**, documented RPO/RTO. Needed in Phase A
   because a real balance already lives in Postgres, and is a **hard
   prerequisite before any entity is made Postgres-primary** (Phase F/G) — a
   cutover without a proven restore path is NO-GO.
3. **`drizzle-kit` adopted:** `drizzle.config.ts`, `generate`/`migrate` scripts,
   a CI drift check, and an **advisory lock** in the migration path.
4. **Portal DB access pattern decided & scaffolded:** repository layer
   (`src/lib/repositories/*`), `neon-http` for reads, a **pooled driver**
   (`src/db/pool.ts`, Neon `-pooler` / PgBouncer transaction mode) for
   transactional paths (booking reservation, cascade delete, decision cascade,
   credit-deduction+queue-write).
5. **`/api/internal/*` service API design signed off:** scoped service token
   (server-side only, not `NEXT_PUBLIC_`), Zod-validated payloads, enum mapping,
   idempotency-key handling, structured logging. No endpoints built until the
   owning entity reaches Phase G.
6. **n8n + Vapi commitment:** the n8n workflow owner and the Vapi vendor agree in
   principle to re-point their writes to `/api/internal/*` when asked, per
   entity. Voice cannot reach Phase G without this.
7. **Sheet schema freeze:** stop new far-right columns; fix or hard-log the
   silent schema-drift behaviour in the Sheets client first.
8. **Staging rig:** a Neon branch + a copy spreadsheet + a non-prod n8n set, for
   rehearsing every phase and every rollback.
9. **Data-cleanup rules signed off:** person-dedupe match rule (normalised email
   = auto; name/phone-only = manual-merge queue), phone normalisation, the
   status→enum mapping table, the naive-timestamp timezone rule
   (`Asia/Singapore`), orphan quarantine handling, and the Management-Approval
   field disposition (**archive, not migrate as active**).
10. **Parity harness + mismatch dashboard** built (extends
    `backfill-credits.mjs`) and wired into CI.
11. **Rollback runbooks** for C–G written and reviewed, and drilled once in
    staging.
12. **Pilot / UAT sign-off** — the gate for starting anything beyond Phase A and
    the credits soak.

## 14. Which phase is safe to start first

**Phase A — schema preparation & infrastructure — now.** It is entirely
additive and off the production path: `drizzle-kit` + CI, Neon PITR/backups + a
tested restore, the pooled-driver module (unused), the draft DDL on a branch, the
`/api/internal/*` written design, the staging rig, the parity harness skeleton,
and making schema drift non-silent. Nothing there changes production behaviour,
touches `CREDITS_BACKEND`, or edits an n8n workflow, and every item is reversible.

**In parallel: continue Phase B observation** — the credits dual-write
zero-divergence soak. It needs watching Vercel logs and running the backfill
compare, not code. Credits stay on `dual`.

**Do not start Phase C** (shadow-writes) for any entity until Phase A's
prerequisites — especially Neon backups (#2), `drizzle-kit` (#3), the
`/api/internal/*` design (#5), and pilot/UAT sign-off (#12) — are all met.

## 15. GO / NO-GO

**GO** — begin **Phase A** (schema/infra preparation) immediately, and **continue
Phase B** (credits dual-write soak, `CREDITS_BACKEND` stays `dual`). Both are
non-disruptive, reversible, and prerequisites for everything else.

**NO-GO** — Phases **C through H** (recruitment-domain shadow-writes, backfill,
parity reads, read-primary, source-of-truth, Sheets downgrade) for **every
entity**, until **all** of:
- pilot / UAT sign-off is obtained;
- the Phase A prerequisites in §13 are complete and signed off (backups tested,
  `drizzle-kit` + CI, pooled driver, `/api/internal/*` design, staging rig,
  parity harness, data-cleanup rules, rollback runbooks);
- explicit written operator approval per entity to move it from shadow to
  PG-primary, on that entity's own parity evidence.

**Unconditional NO-GO for this plan:** switching `CREDITS_BACKEND` to `postgres`;
editing live n8n / Vapi workflows; reviving any Management-Approval workflow step;
raising the 8-file bulk cap; any change to RBAC semantics or the voice
retry/no-show lifecycle.

---

*Prepared as an audit and plan only. No migration, schema cutover, or
Postgres-only switch has been performed or is authorised by this document beyond
Phase A preparation and continued observation of the existing credits dual-write
soak.*
