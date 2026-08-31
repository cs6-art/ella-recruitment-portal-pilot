# R1 investigation — Bulk_Resume_Queue "stuck in Processing"

**Date:** 2026-08-31 · **Access used:** Google Sheets service account (read),
Neon (read), repo. No n8n access. `CREDITS_BACKEND` untouched.

## TL;DR — R1 as originally reported was a measurement artifact

`Bulk_Resume_Queue` is an **append-only event log**, not a state table. The
portal writes a `Processing` row per file; n8n later **appends a separate**
`Screened` / `Failed` row (it does not update in place). Retries append more
rows. Counting raw rows double-counts every file.

| View | Rows | Processing | Screened | Failed |
| --- | ---: | ---: | ---: | ---: |
| **Raw event rows** (the original R1 count) | 3,688 | 1,810 (49%) | 1,246 | 603 |
| **Latest state per `roleId\|driveFileId`** (what `getBulkResumeQueue` actually returns) | **1,398 unique resumes** | **10 (0.7%)** | 1,229 (87.9%) | 147 (10.5%) |

The application already collapses events to latest-state-per-file, **and** the
status route (`GET /api/resume-screening/bulk`) additionally cross-checks each
row against saved applicant results and re-labels stale `Processing` rows in the
response. HR never sees the raw 49%.

**Corrected severity: LOW.** Not a release blocker. Real issues found are a
one-off Aug-19 webhook-secret incident and the absence of a queue-reconciliation
sweep (cosmetic, the UI compensates).

## The 10 genuinely-stuck rows

All 10 have their **last** event = `Processing`. Verified each against
`High_Match_Profile` using the same evidence matcher the portal uses
(`Status (Resume Processing)` ∈ {processed, for hr review, pending hr review}
AND `Recommendation` present):

| Outcome | Count | Detail |
| --- | ---: | --- |
| **Screened OK, queue row just stale** | **8** | applicant exists in `High_Match_Profile`, `Status = Processed`, `Recommendation = "For HR Review"`. n8n completed screening and wrote the applicant but never appended the terminal `Screened` event to the queue. All 8 ingested via the **Drive folder-poller** path (bare `Processing` row: no `jobId`, no `batchId`, blank `environment` — the portal always sets those). All re-screened during 2026-08-17→19. |
| **Correctly not screened (user error)** | 1 | `General Manager - Job Description.docx.pdf` fed to GM01 as a résumé — it is the job description. No result is correct. |
| **Genuine failure** | 1 | `LONTOC-resume.pdf` (SM01). Portal retried it 3× on 2026-08-19; attempts 1–2 failed `"Invalid workflow secret."`, attempt 3's `Processing` row is the last event. Collateral of the Aug-19 incident below. No saved result. |

**Do screening results exist for Processing rows? Yes for 8 of 10.** Those
candidates are in the normal HR review pipeline; only the sheet row is stale.

## Root-cause hypotheses, ranked

### 1. n8n completes screening but does not append the terminal event (folder-poller path) — CONFIRMED, primary

**Evidence.** 8 of the 10 stuck rows have a full saved applicant result but no
`Screened` queue event. All 8 are folder-poller rows (no portal metadata).
Separately, of 1,246 `Screened` events in the whole tab, **1,160 (93%) carry no
`jobId`** and 1,159 have blank `environment` — i.e. n8n's writeback row is a
"thin" row that doesn't echo the `Processing` row's identifiers. So n8n's
writeback step exists and usually fires (1,245 times in August), but for the
folder-poller re-run it sometimes did not. Most likely the folder-poller
workflow's "mark Screened" branch has a gap for resumes that were *already*
screened once (dedupe path) or errored after the applicant write.

### 2. One-off webhook-secret misconfiguration on 2026-08-19 — CONFIRMED, secondary

**Evidence.** `"Invalid workflow secret."` appears on **225** Failed events,
**every one between 2026-08-19 03:01 and 07:06 UTC** — a single ~4-hour window,
never before or since. The portal's bulk webhook secret and the n8n webhook's
expected secret diverged (rotation applied on one side only), a large
re-screening batch was run into it, 225 files bounced pre-screening, then it was
fixed. 66 of those are still in latest-`Failed` state (never retried); the rest
were retried successfully. The 1 genuine stuck row (`LONTOC`) is collateral.

### 3. No scheduled reconciliation of stale queue rows — CONFIRMED, contributing

**Evidence.** `src/instrumentation.ts` schedules resume-file cleanup and
interview no-show maintenance via `setInterval`, but **nothing** for
`Bulk_Resume_Queue`. There is no Vercel Cron (`vercel.json` absent) and no
`/api/cron/*` route. Also `setInterval` in `instrumentation.register()` does not
run reliably on Vercel serverless (the function freezes between invocations), so
even the interview maintenance is opportunistic. Result: a stale `Processing`
row is never repaired in the sheet — it is only re-labelled at read time, for
the selected role, for the first 50 rows.

### 4. Screening genuinely never completes (n8n stall) — MINOR

**Evidence.** Only **27** events across the whole history carry a
timeout/stall message (`"timeout of 20000ms"`, `"the n8n workflow execution
stalled … never reached a terminal status"`), all in August, and **25 were
retried** — only 2 remain in latest-`Failed`, both explicitly *"Marked Failed
by HR"*. The Aug-15 incident the original report cited was already triaged and
closed by HR. Not systemic.

### 5. Webhook delivery failure (network) — NOT SUPPORTED

No connection-level errors in the data; failures are all application-level
(secret rejected, bad PDF, no contact info, workflow rejected).

### 6. Duplicate / idempotency issue — NOT SUPPORTED

`X-Idempotency-Key: <queueId>` is sent on every webhook. 12 `Skipped` rows total.
No evidence of duplicate screening or double credit deduction (Neon ledger has
exactly one `cv_analysis` row historically; balance reconciles).

### 7. Status reconciliation bug in the portal — NOT SUPPORTED

The read-time reconciliation in `GET /api/resume-screening/bulk` is correct: it
maps evidence-backed `Processing` → `Screened` and stale (>30 min, no evidence)
`Processing` → `Failed` in the response. Its only limitation is that it is
display-only and capped at 50 rows for one role.

## Wider outcome picture (latest-state, 1,398 unique resumes)

- **Screened 1,229 (87.9%)** — pipeline works.
- **Failed 147 (10.5%)**: 66 Aug-19 secret incident · 39 job-description PDFs
  mis-uploaded as resumes · 17 resumes with no extractable name/email/mobile ·
  ~25 corrupt PDF/DOC · 2 HR-marked stalls. Input-quality + one config incident,
  not a pipeline defect.
- **Processing 10 (0.7%)** — as above.
- The entire tab's processing happened in **August 2026** (a full historical
  re-screening exercise); `discoveredAt` dates 2025-11→2026-08 are folder
  discovery times, not screening times. A UAT batch on 2026-08-31 screened
  cleanly with proper `jobId` rows — the current pipeline writes back correctly.

## Safest fix

**Portal-only, no n8n change, no schema change:**

1. **`reconcileBulkResumeQueue()`** — for every identity whose latest event is
   `Processing` and older than 30 min, run the existing
   `getBulkResumeScreeningEvidence` check and **append** one terminal event:
   `Screened` if evidence exists, else `Failed` ("Screening did not produce a
   saved result within 30 minutes"). This is exactly the logic
   `GET /api/resume-screening/bulk` already computes for display — just
   persisted. Append-only, so it cannot corrupt history and cannot re-trigger
   n8n or re-charge credits.
2. Expose it as **`GET /api/cron/reconcile-bulk-queue`** guarded by a
   `CRON_SECRET` header, and add a **Vercel Cron** (`vercel.json`) at e.g.
   every 15 min. This also establishes the pattern to move the unreliable
   `instrumentation.ts` `setInterval` maintenance onto Cron (separate change).
3. **Webhook-secret drift:** make the bulk webhook secret mismatch a **loud,
   single alert** (it currently just writes N individual `Failed` rows). Log one
   `console.error("[Bulk Intake] webhook secret rejected")` per batch and
   surface it in the batch response so an operator notices immediately. Pin down
   whether the pilot and prod n8n share a secret and document the rotation
   procedure in `SECOND-INSTANCE-SETUP.md`.

## Can the existing stuck rows be safely reconciled? YES

- **8 rows** → append a `Screened` event (evidence confirmed). Zero risk: the
  applicant already exists, the credit was already handled at original webhook
  time, appending an event only changes the latest-state label.
- **1 row** (`General Manager - Job Description.docx.pdf`) → append `Failed`
  "Uploaded file is a job description, not a resume."
- **1 row** (`LONTOC-resume.pdf`) → append `Failed` "Webhook secret rejected on
  2026-08-19; safe to re-upload." Then HR re-uploads once.
- No credit adjustment needed: the Neon/Sheet ledgers already reconcile at
  balance 0 and contain no bulk `cv_analysis` deductions from this exercise
  (historical deductions were the pre-August single-file tests).

The `reconcileBulkResumeQueue()` function above does items 1 automatically; the
2 special cases can be a one-time manual append or left to the function's
`Failed` branch (both are >30 min old with no evidence).

## Regression tests needed

1. **`getBulkResumeQueue` collapses append-only events** — given multiple events
   for one `roleId|driveFileId` (Processing → Failed → Processing → Screened),
   the returned item is `Screened`; count of returned items = count of unique
   identities, not rows. (Guards against the metric that produced R1.)
2. **`reconcileBulkResumeQueue`** — (a) latest `Processing` + matching evidence
   → appends `Screened`; (b) latest `Processing`, no evidence, age > 30 min →
   appends `Failed`; (c) latest `Processing`, no evidence, age < 30 min → no
   append; (d) latest already terminal → no append; (e) idempotent (running
   twice appends at most once).
3. **Webhook-secret rejection path** — screening webhook returns 401 → queue row
   `Failed` with the secret message **and** `recordDeduction` is **not** called.
4. **Evidence matcher precision** — a file with `Status (Resume Processing)` set
   but `Recommendation` blank → **not** counted as evidence (no false
   `Screened`); a JD-only file → not matched.
5. **Cron route auth** — `/api/cron/reconcile-bulk-queue` without the
   `CRON_SECRET` header → 401.

## Minimum n8n read-only access still wanted (to close hypothesis 1 fully)

Not required to act on the fix, but to confirm *why* the folder-poller skipped
the writeback:

- **n8n instance base URL** + a **read-only API key** (`X-N8N-API-KEY`), scoped
  to the pilot project `wwjZ8XFETyncXLez`.
- I would call `GET /api/v1/executions?workflowId=<folder-poller id>&status=error`
  and `GET /api/v1/executions/{id}` for the 2026-08-17→19 window, and inspect the
  `JD Role Folder Bulk Resume Screening` workflow's node graph for the
  "append Screened row" branch.
- No workflow edits — read-only.
