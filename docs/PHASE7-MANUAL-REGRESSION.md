# Phase 7 — full regression

## Automated portion — PASS (2026-08-31, HEAD after the layout fix)

| Check | Result |
| --- | --- |
| `tsc --noEmit` | ✅ 0 errors |
| `eslint src tests` | ✅ 0 errors (8 pre-existing warnings) |
| `node --test tests/*.test.mjs` | ✅ **164 / 164** |
| `npx playwright test` (browser smoke) | ✅ **4 / 4** |
| `next build` | ✅ compiled successfully |

**Regression fixed during this pass (pre-existing, surfaced by the browser
smoke run):** `src/app/layout.tsx` rendered an inline `<script>` as a direct
child of `<html>` — invalid HTML, a Next 16 hydration error, and the resulting
dev-tools error overlay was intercepting clicks. Moved the sidebar-preference
script to the top of `<body>`. Browser smoke went 3/4 → 4/4.

Also observed (local-only, not a product defect): `[Resume Cleanup] Scheduled
cleanup failed — Resume storage Drive folder is not configured` when
`RESUME_STORAGE_DRIVE_FOLDER_ID` is unset in local `.env.local`. The error is
caught; the pilot has the var set.

## Live regression — human pass on the deployed pilot

Run after feature work is frozen. Mark each PASS/FAIL with a note + evidence
link (screenshot, sheet row, log line). Fix only regressions **caused by the
current release**; pre-existing issues get logged.

Environment: deployed pilot, `CREDITS_BACKEND=dual`.

Already covered by the 2026-08-31 live runs (evidence in
`DRIVE-E2E-VALIDATION-2026-08-31.md` / `PHASE-2-BACKEND-MIGRATION.md`):
rows 9–10 (upload + Drive import), 12 (bulk 8-file), 13 (dedupe), 14 (credit
deduction — 1/CV, 0 on failed), 15 (insufficient-credit 402), 16 (Sheet ↔ Neon).

| # | Area | Test | Expected | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Login / SSO | Sign in with an allowed `mclinkgroup.com` Google account | lands on dashboard; session cookie set | | |
| 2 | Login / SSO | Sign in with a non-allowed domain | rejected | | |
| 3 | RBAC | Creator-only user opens `/dashboard`, `/settings`, `/user-accounts` | pipeline metrics + settings hidden per role | | |
| 4 | RBAC | Non-HR hits `/api/resume-screening/bulk/upload` and `/drive/import` | 403 | | |
| 5 | Role creation | Create a role request end-to-end | saved; appears in list | | |
| 6 | Recruitment setup | Fill setup, toggle evaluation criteria, set F2F venue, publish | publishes; venue required when HOD interview required | | |
| 7 | Approval workflow | Confirm the **management-approval step is gone**; role goes straight to the simplified path | no "Pending Management Approval" state | | |
| 8 | Candidate application | Public apply form for a published role | application recorded; confirmation shown | | |
| 9 | Local resume upload | Upload 3 mixed PDF/DOC/DOCX for a role | queue rows, credits −3, statuses progress | | |
| 10 | Google Drive import | Worksheet A result | 2 files screened, −2 credits | | |
| 11 | Single screening | Screen one applicant from the applicants view | score + recommendation populated | | |
| 12 | Bulk screening | 8-file batch (Worksheet B) | all terminal; no orphan rows | | |
| 13 | Duplicate detection | Re-submit an already-screened resume (local + Drive) | Skipped, no charge | | |
| 14 | Credit deduction | Compare ledger delta to files accepted across tests | 1 per accepted CV; 10 per phone interview | | |
| 15 | Insufficient credit | Drop balance below batch size, submit | 402, nothing dispatched | | |
| 16 | Postgres dual-write | Sheet balance == `credit_balance`; no divergence logs after a full day | match | | |
| 17 | Pricing / volume discount | Top up above the discount threshold | bonus `volume_discount` ledger row added | | |
| 18 | Post-screening notification | Batch completes with notifications ON | completion email received; screening unaffected if email fails | | |
| 19 | AI interview booking | Advance a candidate to AI interview; open booking link | slot booked; calendar event created | | |
| 20 | F2F venue / address | Book an F2F interview | venue text appears in the invitation | | |
| 21 | AI phone interview | Complete a voice interview (or a dry run) | transcript captured | | |
| 22 | Missed-call handling | Candidate does not answer | attempt logged; retry scheduled | | |
| 23 | 3-attempt lifecycle | Exhaust attempts 1→2→3 | attempt counter advances; No Show at end; completed results never overwritten | | |
| 24 | Transcript generation | After a completed interview | transcript stored and viewable | | |
| 25 | Ella summary / question mapping | Open an interview summary | each answer under the correct canonical question | | |
| 26 | AI scoring | (Phase 6 benchmark) | deltas within tolerance | blocked on HR | |
| 27 | Calendar booking | Book, then reuse the same final token | token single-use; second attempt shows branded unavailable page | | |
| 28 | Database operations | Sheets reads paced; no quota errors under normal use | no 429s from Sheets | | |
| 29 | n8n performance | Time a bulk batch through n8n | within processing window; no duplicate executions | | |
| 30 | Form persistence | Start a role request, navigate away, return | draft autosaved and restored | | |
| 31 | Error handling | Submit malformed inputs across forms | validation messages, no 500s | | |
| 32 | Retry behaviour | Retry failed files from a batch | only failed files re-submitted | | |
| 33 | Partial failures | Batch with 1 corrupt file | rest of batch unaffected | | |

OneDrive: **Deferred / Not part of this release validation** — skip rows.

Exit criterion: **no unresolved critical regression defect attributable to this
release.**
