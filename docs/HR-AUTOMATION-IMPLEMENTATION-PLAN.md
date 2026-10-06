# HR automation and Google resilience: implementation plan

Status: approved for implementation (decisions D1–D7 settled 2026-10-06). Planning only; nothing below is built yet.

Scope: six improvements to the Recruitment Portal. Production runs `RECRUITMENT_BACKEND=postgres`, so every change targets the Postgres path. The legacy Google Sheets branches in `src/lib/applicant-workflow.ts` stay untouched; new features return "not supported" there.

## Settled decisions

| # | Decision |
|---|---|
| D1 | Auto-advance is switched on from a dedicated "Interview automation" card on the role page. Only applicants screened **after** it was switched on are auto-advanced. |
| D2 | **Strict.** Face-to-face booking still requires a connected Google Calendar. No portal-only face-to-face slots. |
| D3 | **Deferred.** Live Avatar still requires the organization's recording Drive. Cloudflare R2 fallback is a later project. |
| D4 | Overdue roles are also hidden on the public `/apply` pages. |
| D5 | "Select all" selects the current page only (v1). |
| D6 | Google connection status is checked live (short cache). No stored integration-health table. |
| D7 | New-applicant read state is stored **server-side, per user, per applicant** (many users across devices). |

## Findings from the codebase inspection

1. **Interview source of truth already exists.** `interview_slots` is the portal's own record. Google Calendar is stored as secondary fields (`calendarEventId`, `calendarEventStatus`, `calendarEventError`) with a retry queue (`processTargetCalendarEventQueue`, driven by the internal `bookings/calendar/process` route). No interview data-model migration is needed.
2. **Screening never outputs "Recommended".** `src/lib/recruitment-screening.ts` forces `recommendation: "For HR Review"`. The only reliable auto-advance criterion is `screening_results.match_score` (0–100).
3. **"Interview stage" = AI interview invitation.** Resume approval moves `resume_review → resume_approved` and creates the voice and avatar booking tokens (`targetRecordApplicantDecision`, `src/lib/recruitment-target-portal.ts:803`).
4. **Security gap to fix first.** `applyHrDecision` (`src/lib/internal-recruitment-queries.ts:1912`) looks up the application by `externalId` with no `organization_id` predicate, and `POST /api/applicants/[applicationId]/decision` only checks the user's role. An HR user could decide another organization's applicant if they knew its ID. The detail page does check the organization (`targetApplicantDetails`).
5. **Drive is mostly optional already.** Resume upload uses the service-account storage; the user's Drive is only for "Choose from Google Drive". The hard dependency is Live Avatar recording (`src/app/api/live-avatar/session/route.ts:108-118`), deferred under D3.
6. **Multi-select exists** on the Applicants list (`ApplicantsList.tsx`, `selectedIds`) for bulk delete, which sends one request per applicant.
7. **New-applicant badge bug (D7).** Read state is a single per-browser timestamp in localStorage (`src/lib/new-applicants.ts`). It is moved to "now" when the bell panel closes (`NewApplicantsBell.tsx:87-90`, which includes clicking one applicant) and whenever the Applicants page mounts (`ApplicantsList.tsx:241-245`). Opening one new applicant clears all of them.
8. **Dashboard alerts look dead.** Only the small action link in each alert card is clickable (`DashboardMetrics.tsx:330`), and every target is a generic page (`/applicants`, `/bookings`, `/settings`, `/roles`) with no filter or anchor.
9. **Uncommitted local changes** exist in `BookingsList.tsx`, `access-control.ts`, `api/auth/google-calendar/callback/route.ts` and others. Commit or stash them before starting. The callback change rewords the account-mismatch message to "not the one you signed in with", which is wrong for the shared HR calendar (it expects the configured "HR calendar account"); do not ship that wording.

---

## 0. Foundation: organization-scoped approval service

**Change**
- Add an `organizationId` predicate to `applyHrDecision` (and `updateApplicationStage`): select the application with `externalId` **and** `organization_id`. A mismatch returns `unknown_application`.
- Pass `user.organizationId` from the decision route through `recordApplicantDecision` → `targetRecordApplicantDecision`.
- Add an optional `source` parameter to `applyHrDecision` (default `internal_api:hr_decision`, unchanged).
- Extract `approveForInterview({ applicationExternalId, organizationId, mode, actor, actionRequestId, comments })` from `targetRecordApplicantDecision`: the resume-stage approve plus voice and avatar token creation. `mode` is `"auto" | "manual" | "manual_override"` and selects the history `source`.

**Tests**: cross-organization ID is rejected; existing decision tests unchanged; `source` defaults preserved.

**Risk: Medium** (touches the core decision path; behaviour otherwise identical).

---

## 1. Automatic interview progression (role-level)

**Current**: every applicant waits in `resume_review` for a manual approval.

**Configuration (no migration)**: stored in `roles.setup` (JSONB), validated by a small dedicated schema, not the main `recruitmentSetupSchema` form:
- `autoAdvanceEnabled: boolean` (default `false`)
- `autoAdvanceMinScore: integer 1–100`
- `autoAdvanceEnabledAt: ISO timestamp` (set each time it is switched on)
- `autoAdvanceEnabledBy: email`

**UI placement (D1)**
- New **"Interview automation"** card on the role page (`RoleDetails.tsx`), near the top, visible for live roles (`approved`, `recruitment_setup`, `job_posted`) that are not overdue.
  - On/off switch and minimum-score input.
  - "On since <date> by <name> · applies to newly screened applicants only".
  - "<n> applicants are still waiting for review → Review them" linking to the role's Resume Review list sorted by match score.
- Status chip on the role's Applicants page header: "Auto-invite on · 80%+", linking to the card.
- Notice in Bulk Resume Screening after a role is chosen: "Applicants scoring 80%+ will be invited automatically."
- Only users with `canEditRecruitmentSetup` can change it. Switching off and on resets `autoAdvanceEnabledAt`.

**Endpoint**: `PUT /api/roles/[roleId]/interview-automation` `{ enabled, minScore }`. Server sets `enabledAt`/`enabledBy`, checks organization and role status, uses the role's `updatedAt` optimistic check like the setup route.

**Trigger**
- `maybeAutoAdvance(applicationExternalId)` in new `src/lib/auto-advance.ts`, called **after** each screening write commits (never inside the screening/credit transaction):
  - `finalizeBulkScreening` caller in `src/lib/recruitment-target-screening.ts`
  - `POST /api/internal/recruitment/screening` (`upsertScreeningResult`)
  - the `copyScreeningResult` caller in `recruitment-target-portal.ts`
- Advances only if: role auto-advance enabled; `screening_results.screened_at >= autoAdvanceEnabledAt`; stage `resume_review`; not withdrawn; `match_score` not null and `>= minScore`; role not archived or overdue.
- Calls `approveForInterview(mode: "auto")` with `actionRequestId = auto-advance:resume:<applicationExternalId>`.

**Retries**
- New `GET /api/cron/auto-advance` (same `CRON_SECRET` bearer pattern as the existing crons) plus a `vercel.json` entry.
- Sweep per organization: (a) qualifying `resume_review` applicants missed by the hook; (b) applicants stuck at `resume_approved` with no voice token (token creation runs after the decision transaction and is not atomic with it).
- Also run the sweep for the current organization on dashboard load, rate-limited (at most once per 5 minutes per organization), so recovery does not wait for the daily cron.

**Duplicates**: unique `actionRequestId`; `applyHrDecision` checks the stage under `FOR UPDATE`; `createBookingToken` reuses an existing token. A manual approval racing an auto one gets `invalid_transition` and is reported as already approved.

**History**: `source: "auto:screening_condition"`, label in `HISTORY_SOURCE_LABELS` (`src/lib/applicant-stage-labels.ts`): **"Automatically approved — screening condition met"**. Comment records score and threshold, e.g. "Score 86% met the role's 80% threshold."

**Edge cases**: null score never advances; changing the threshold does not re-evaluate past applicants; invitations send email (pilot recipient policy still applies); Live Avatar interviews later consume credits.

**Tests**: condition unit tests (disabled, null, equal, below, screened before `enabledAt`); hook-twice-plus-sweep produces one history row and one token; manual/auto race; stuck `resume_approved` recovery; endpoint auth and organization checks.

**Risk: High** (unattended emails and later credit spend; three screening write paths).

---

## 2. Bulk "Approve for Interview"

**Endpoint**: `POST /api/applicants/bulk-approve` `{ applicationIds: string[] (1–100), comment?: string }`.
- `canDecideApplicant`; every ID loaded with `organization_id = session organization`, mismatch → `not_found`.
- Per-user rate limit (10 batches / 15 min). `export const maxDuration = 60`.
- Sequential `approveForInterview` per ID with `actionRequestId = bulk-approve:<batchId>:<applicationId>`; one failure never stops the batch.
- Outcome per ID: `approved | already_approved | interview_exists | screening_pending | not_found | failed`.
- `mode`: `manual_override` when the role has auto-advance on and the applicant is below the threshold (label **"Approved by HR — manual override"**), otherwise `manual` (label **"Approved by HR"**). Single approvals from the applicant page use the same rule.
- Revalidate `/applicants` and `/dashboard`.

**UI** (`ApplicantsList.tsx`)
- Sticky toolbar while anything is selected: "5 applicants selected | Approve for Interview | Delete selected | Clear".
- Select-all = current page (D5). Approve count only includes Resume Review rows; others are shown as "will be skipped".
- Confirmation modal (`ConfirmationModal.tsx`): count, note that invitation emails are sent, optional comment.
- Result summary built from outcomes, e.g. "8 applicants approved for interview. 1 applicant skipped because an interview already exists." Then refresh and clear selection.

**Tests**: unauthorized; foreign-organization ID; mixed-stage batch outcomes; same batch twice = no duplicates; toolbar and summary contract test.

**Risk: Medium.**

---

## 3. Rename "Bookings" → "Interview Calendar"

UI wording only; keep `/bookings`, API routes, tables and variable names.

**Locations**
- Sidebar and mobile nav: `src/components/AppShell.tsx:132` (one component serves both).
- Page heading and loading state: `src/app/bookings/page.tsx`, `src/components/BookingsList.tsx:313` ("Interview Calendars" → "Interview Calendar").
- Dashboard alert: `src/lib/dashboard-attention.ts:83-85` ("Review bookings", "The bookings are saved.").
- Dashboard links text where it says bookings/schedules (`DashboardMetrics.tsx`).
- Help bot: `src/lib/help-bot/knowledge.md` (lines 37, 724, 883, 889).
- User Manual: `docs/McLink-Recruitment-Portal-User-Manual.html`.
- Leave candidate-facing "Booking Link" wording unchanged.

**Tests**: update string assertions; add a test that no HR-facing "Bookings" nav label remains.

**Risk: Low.**

---

## 4. Hide overdue roles from active-role selection

**Rule**: new `isRoleOpenForSelection(role, now)` in `src/lib/recruitment-role-eligibility.ts` = existing live/published check AND NOT `isTargetHiringDateOverdue(role.targetHiringDate, PORTAL_TIME_ZONE, now)` (`src/lib/interview-availability-rules.ts:164`).
- Target date before today (Asia/Singapore) → hidden. Today or future → shown. No target date → shown.

**Apply to pickers (server side)**
- `src/app/resume-screening/page.tsx`
- `src/app/api/resume-screening/bulk/route.ts` (role list)
- `src/app/applicants/page.tsx` (`publishedRoles` for manual add)
- `src/app/bookings/page.tsx` (HR exception-slot role picker)
- `src/app/apply/page.tsx`, `src/app/apply/[roleId]/page.tsx`, `src/app/api/public/roles/route.ts` (D4)

**Apply to write validation**: bulk upload, `POST /api/applicants` (manual add), `roles/[roleId]/resume-screening/invite`, `POST /api/bookings/slots`, public application submit. Reject with a friendly "This role's target hiring date has passed" message.

**Do not change**: Roles list, role details, Applicants role filter, applicant history, dashboards, reports.

**Tests**: helper at yesterday/today/tomorrow/empty/invalid and at 23:59 / 00:00 SGT; contract tests that each picker and validation uses the helper.

**Risk: Low.**

---

## 5. Google Calendar: strict booking, resilient everything else (D2 = strict)

**Keep**: face-to-face slots and booking still require a connected HR Google Calendar (`targetBookingContextInTenant`, `targetReserveBookingInTenant`, `targetCreateInterviewSlot` gates stay).

**Change**
1. **Error classification** in `src/lib/google-calendar.ts`: `classifyCalendarError()` → `not_connected | needs_reconnect (invalid_grant, revoked, account mismatch) | unavailable (network, 5xx, timeout)`. `getCalendarIntegrationStatus(organizationId)` returns `connected | not_connected | needs_reconnect | unavailable`, derived live (D6) with a short per-request cache.
2. **Friendly messages only.** HR never sees raw OAuth/API text. Examples:
   - Sync failed after booking: "Google Calendar needs to be reconnected. Your interview was still saved successfully in the portal."
   - Not connected: "Connect Google Calendar to offer face-to-face interview times."
3. **Sync never rolls back an interview.** Already true for booking; keep it true for the new reschedule/cancel actions.
4. **HR reschedule and cancel** (new, Postgres path):
   - `PATCH /api/interviews/[slotId]` `{ action: "reschedule", date, startTime, endTime } | { action: "cancel" }`; `canManagePipeline` + slot `organization_id`.
   - Reschedule: requires Calendar connected and free at the new time (strict, same as booking); updates the slot, then updates the Google event (new `updateFinalInterviewEvent`); on Google failure keep the portal change and mark `calendarEventStatus = "failed"` for the retry queue.
   - Cancel: slot `cancelled`, applicant back to `approved_for_final`, fresh final booking token; delete the Google event (treat 404 as already deleted); failure recorded, not fatal.
5. **UI** (`BookingsList.tsx`): per face-to-face record a "Synced to Google" / "Sync failed — retrying" badge, Reschedule and Cancel actions, and a small banner with Connect/Reconnect when status is not `connected`.
6. **Dashboard alert** stays ("Face-to-face interviews cannot be offered…" is accurate under D2) but links to `/settings#calendar-settings-title`. Add a `needs_reconnect` variant.
7. Settings `GoogleCalendarConnect.tsx`: show Reconnect state for `needs_reconnect`.

**Database**: none (`calendarEventStatus` is free text; `cancelled` slot status already exists).

**Tests**: error classification; reschedule/cancel transactions including the Google-failure path; status mapping; existing `interview-calendar-contract.test.mjs` and `availability-guards.test.mjs` must still pass (gates unchanged).

**Risk: Medium.**

## 5b. Google Drive (D3 deferred)

- Bulk Resume Screening: replace "Google Drive is not connected" with the non-blocking banner "Google Drive is not connected. You can continue uploading files directly to the portal." plus **Connect Google Drive**; map Picker/token failures to a **Reconnect** state. Direct upload stays primary.
- Live Avatar recording storage: no behaviour change. Add a clearer HR warning on the dashboard and Getting Started when Live Avatar is in use but the recording Drive is missing or needs reconnecting, before a candidate hits the "temporarily unavailable" message.
- Later project (not in this pass): Cloudflare R2 recording fallback with direct browser multipart uploads via presigned URLs (Vercel 4.5 MB body limit), playback through the existing authorization check, retention deletion, privacy-policy line.

**Risk: Low.**

---

## 6. Alerts that seem to do nothing

### 6a. Dashboard "Actionable Alerts"
- Make the whole alert card one `<Link>` (keep the action label as text; visible focus style).
- Specific targets per alert in `src/lib/dashboard-attention.ts`:
  - `stalled-applicants` → `/applicants?stage=<stalled stages>&stalled=1`
  - `voice-outcome-missing` → `/bookings?type=voice&status=Booked&past=1`
  - `calendar-disconnected` → `/settings#calendar-settings-title`
  - `bulk-screening-failed` → `/resume-screening?status=failed`
  - `emails-failed` → `/applicants?notification=failed`
  - `roles-not-published` → `/roles?status=Approved`
- Add the needed filters to `GET /api/applicants` and read them from the URL in `ApplicantsList.tsx` and `BookingsList.tsx`.
- "Open alerts" KPI: smooth-scroll and move focus to the alerts section.
- If a target filter matches nothing: "This alert refers to a record that is no longer available."

### 6b. New-applicant bell: server-side per-user read state (D7)

**Problem**: one per-browser timestamp; opening one applicant (or the Applicants page) clears all.

**Migration `drizzle/0039_applicant_seen_state.sql`** (plus `src/db/schema-recruitment.ts`):
- `applicant_seen (organization_id uuid, user_email text, application_id uuid references applications(id) on delete cascade, seen_at timestamptz default now(), primary key (organization_id, user_email, application_id))`
- `user_notification_state (organization_id uuid, user_email text, applicants_cleared_at timestamptz not null, primary key (organization_id, user_email))`

**Rule**: an applicant is NEW for a user if `applied_at > applicants_cleared_at` AND there is no `applicant_seen` row. On a user's first request, create `user_notification_state` with `applicants_cleared_at = now()` so existing applicants are not all flagged NEW.

**Endpoints**
- `GET /api/applicants/recent` returns the user's unseen applicants and the count (computed server-side).
- `POST /api/applicants/[applicationId]/seen`: called from the applicant detail page on mount (client side, so link prefetch never marks anything seen). Organization-checked; idempotent upsert.
- `POST /api/applicants/seen/mark-all`: sets `applicants_cleared_at = now()`.
- Applicants list rows include `isNew` from the server.

**UI**
- Bell and sidebar badge count down one at a time as each applicant is opened.
- Opening the Applicants page no longer clears anything; NEW rows stay highlighted until opened.
- "Mark all as read" in the bell panel.
- Remove `writeApplicantsLastSeen` calls from `NewApplicantsBell.tsx` (panel close) and `ApplicantsList.tsx` (mount). Retire the localStorage watermark.
- Keep the shared 5-minute poll; re-fetch after mark-seen/mark-all.

**Retention**: rows cascade on application delete; optionally prune `applicant_seen` older than 180 days in an existing cron.

**Deploy order**: apply migration 0039 to the Neon database **before** deploying the code.

**Tests**: NEW rule unit tests; first-use baseline; seen is per user and per organization; mark-all; cross-organization `seen` POST rejected; delete cascade; UI contract (no localStorage writes remain).

**Risk: Low–Medium** (one small additive migration).

---

## Implementation order

| # | Step | Risk |
|---|---|---|
| 0 | Commit/stash local changes. Organization-scoped decisions, `source` param, `approveForInterview` extraction | Medium |
| 1 | Overdue role filter (item 4) | Low |
| 2 | Rename to Interview Calendar (item 3) | Low |
| 3 | Dashboard alert links (6a) | Low |
| 4 | Bell per-user read state with migration 0039 (6b) | Low–Medium |
| 5 | Calendar resilience, reschedule/cancel (item 5) | Medium |
| 6 | Drive banner and recording-drive warning (5b) | Low |
| 7 | Bulk approve (item 2) | Medium |
| 8 | Auto-advance (item 1), shipped off by default | High |
| 9 | Full regression: `npm test`, `tsc --noEmit`, lint, `next build` | |
| 10 | Browser E2E on a test organization | |

## Database changes

- **Required:** `0039_applicant_seen_state.sql` (6b).
- **None else.** Auto-advance config lives in `roles.setup`; Calendar status values are free text.

## API changes

- New: `POST /api/applicants/bulk-approve`
- New: `PUT /api/roles/[roleId]/interview-automation`
- New: `PATCH /api/interviews/[slotId]` (reschedule, cancel)
- New: `GET /api/cron/auto-advance` (+ `vercel.json`)
- New: `POST /api/applicants/[applicationId]/seen`, `POST /api/applicants/seen/mark-all`
- Changed: `POST /api/applicants/[applicationId]/decision` (organization check, override label)
- Changed: `GET /api/applicants/recent` (server-side NEW), `GET /api/applicants` (alert filters, `isNew`)
- Changed: bulk resume, manual add, screening invite, slot creation and public apply routes reject overdue roles
- Changed: `POST /api/internal/recruitment/screening` and bulk screening processing call `maybeAutoAdvance` after commit

## Main risks

1. Auto-advance sends invitation emails and leads to credit spend unattended. Off by default, only new applicants, full history audit.
2. Cross-organization decisions exist today; step 0 must land first.
3. Bulk batches on serverless: cap 100, `maxDuration`, per-item isolation.
4. Migration 0039 must be applied before the code deploy.
5. Calendar contract tests encode the strict gate; under D2 they must keep passing, not be rewritten.

## End-to-end HR test (test organization)

1. Create and publish a role; switch on Interview automation at 80%.
2. Bulk-upload 5 resumes; those at 80%+ auto-advance with "Automatically approved — screening condition met"; applicants screened before switching on stay in review.
3. Bulk-approve one below 80% → "Approved by HR — manual override"; summary message correct; re-running skips it.
4. Complete the AI interview; approve for face-to-face; with Calendar disconnected, confirm no slots are offered and HR sees a clear Connect message; connect Calendar; candidate books; event appears in Google Calendar.
5. Reschedule and cancel from the Interview Calendar; disconnect Calendar mid-way to confirm the portal change survives with a friendly sync message.
6. Set a role's target date to yesterday; confirm it disappears from every picker and `/apply`, while its applicants and details remain visible.
7. Click every dashboard alert; each opens a filtered page.
8. With two HR users on two browsers: new applicants count down one at a time per user; opening one does not clear the others; "Mark all as read" clears only that user's.

## Implementation checklist

- [ ] 0.1 Commit or stash existing local changes (drop the wrong calendar-callback wording)
- [ ] 0.2 Organization predicate in `applyHrDecision` / `updateApplicationStage`; pass organization from the decision route; cross-organization test
- [ ] 0.3 `source` parameter on `applyHrDecision`; extract `approveForInterview()`; existing tests green
- [ ] 1.1 `isRoleOpenForSelection()` + unit tests (SGT boundary)
- [ ] 1.2 Apply to all pickers, `/apply` pages and write-validation routes
- [ ] 2.1 Rename UI copy, help bot and manual; update string tests
- [ ] 3.1 Whole-card alert links with specific targets
- [ ] 3.2 Alert filters in `/api/applicants`, Applicants and Interview Calendar read URL filters
- [ ] 3.3 "Record no longer available" fallback; Open-alerts focus
- [ ] 4.1 Migration 0039 + schema; apply to Neon before deploy
- [ ] 4.2 Server NEW rule, `seen` and `mark-all` endpoints, `/recent` and list `isNew`
- [ ] 4.3 Bell, sidebar badge and list use server state; remove localStorage writes; "Mark all as read"
- [ ] 5.1 Calendar error classification and `getCalendarIntegrationStatus`
- [ ] 5.2 Friendly messages everywhere Calendar errors surface
- [ ] 5.3 `PATCH /api/interviews/[slotId]` reschedule/cancel + `updateFinalInterviewEvent`
- [ ] 5.4 Interview Calendar badges, actions and Connect/Reconnect banner; alert link to Settings section
- [ ] 6.1 Drive banner and Reconnect state in Bulk Resume Screening
- [ ] 6.2 Recording-drive readiness warning on dashboard and Getting Started
- [ ] 7.1 `POST /api/applicants/bulk-approve` with outcomes, limits, organization checks
- [ ] 7.2 Toolbar, confirmation modal, result summary
- [ ] 7.3 Manual and manual-override history labels (bulk and single)
- [ ] 8.1 Interview automation card, endpoint, chips on role Applicants page and Bulk Resume Screening
- [ ] 8.2 `maybeAutoAdvance` hooks after the three screening writes
- [ ] 8.3 Cron sweep (incl. stuck `resume_approved`), `vercel.json`, dashboard-load sweep
- [ ] 8.4 Auto history label; idempotency, race and `enabledAt` tests
- [ ] 9 Full regression gate
- [ ] 10 Browser E2E per the HR test above
