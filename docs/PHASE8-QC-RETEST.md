# Phase 8 — formal QC retest of the six original blockers

One section per blocker. **Do not mark PASS without evidence** (screenshot,
sheet row, log line, transcript). "Fix in place" = the code change exists and
compiles; it is not a PASS until the live test is run.

Environment: deployed pilot, `CREDITS_BACKEND=dual`.

---

## 1. Post-screening notifications

- **Original problem:** completion notifications did not reliably fire after
  screening; a failed notification could affect the workflow result.
- **Fix implemented:** notification decoupled from workflow success in
  `bulk-resume-intake.ts`; `bulk_resume_batch_complete` only fires when
  `Bulk_Resume_Notify_On_Success` is enabled **and** every file reached a
  terminal status **and** the batch is not UAT; failure to send is caught and
  never blocks screening.
- **Test performed:** _(Worksheet A step A8 / Phase 7 row 18)_
- **Expected result:** completion email received by HR + management once all
  rows terminal; if the notification endpoint errors, screening results are
  still correct and `notificationStatus: "failed"` is reported.
- **Actual result:** ___
- **PASS / FAIL:** ___
- **Evidence:** ___

## 2. F2F interview address

- **Original problem:** face-to-face interview invitations had no venue /
  address, so candidates did not know where to go.
- **Fix implemented:** `finalInterviewVenue` field added to Recruitment Setup
  (`recruitment-setup-schema.ts`), **required before publishing** when an HOD
  (F2F) interview is required; surfaced in the F2F invitation.
- **Test performed:** _(Phase 7 row 20)_
- **Expected result:** venue text (address, floor/room, arrival instructions,
  on-site contact) appears in the F2F invite; publish is blocked if it is empty
  while HOD interview is Required.
- **Actual result:** ___
- **PASS / FAIL:** ___
- **Evidence:** ___

## 3. Ella interview-summary misattribution

- **Original problem:** answers in the interview summary were shown under the
  wrong questions.
- **Fix implemented:** canonical numbered question set
  (`interview-question-count.ts`, `requiredInterviewQuestion1..5`); summary maps
  each answer to its question by index; one canonical display label.
- **Test performed:** automated guard passes ("provider question counts cannot
  exceed the five-question maximum", "voice interview completion uses one
  canonical display label"); live check _(Phase 7 row 25)_
- **Expected result:** every answer appears under its correct question in the
  summary UI.
- **Actual result:** ___
- **PASS / FAIL:** ___
- **Evidence:** ___

## 4. Candidate no-show handling

- **Original problem:** no structured handling of candidates who miss a booked
  interview; completed results could be overwritten by reconciliation.
- **Fix implemented:** 3-attempt lifecycle scaffolding; past booked interviews
  reconcile to **No Show** without overwriting a completed result; attempt
  counter advances 1→2→3.
- **Test performed:** automated test passes ("past booked interviews reconcile
  to No Show without overwriting completed results"); live check _(Phase 7 rows
  22–23)_
- **Expected result:** lapsed slot → No Show; `attemptCount` increments;
  completed interview results untouched; retry scheduled through attempt 3.
- **Actual result:** ___
- **PASS / FAIL:** ___
- **Evidence:** ___

## 5. n8n / system latency

- **Original problem:** slow / unreliable screening throughput; risk of
  duplicate downstream processing.
- **Fix implemented:** new **pilot** workflows only; webhook
  `X-Idempotency-Key: <queueId>`; concurrency capped at 2 with a 10 s per-file
  stagger to protect the n8n instance and the Sheets write budget.
- **Additional mitigation (2026-08-31):** operator-facing **8-file cap**
  (UI + server) and a **60 s per-file webhook timeout** (`N8N_BULK_RESUME_TIMEOUT_MS`)
  so one stuck n8n execution fails that file, not the batch.
- **Test performed:** timed 2/5/8-file Google Drive import batches on the
  deployed pilot (`BATCH-CAPACITY-VALIDATION.md` / `PHASE-2-BACKEND-MIGRATION.md` §3).
- **Expected result:** ≤ 8-file batches complete in-request with no
  client-visible timeout, no duplicate n8n executions, no orphaned `Processing`.
- **Actual result:** 2 files 34.7 s, 5 files 60.4 s, 8 files 68.0 s — **all
  HTTP `202`, no timeout, no gateway error, 0 orphaned `Processing` rows,
  1 webhook call per file (distinct `batchId`), credits == Screened count,
  Sheet ↔ Neon reconciled after every batch.** 4 resumes completed full AI
  screening end-to-end.
- **PASS / FAIL:** **PASS with pilot mitigation** — throughput and idempotency
  verified for the supported ≤ 8-file range. The async-dispatch refactor
  ("202-then-background-drain") remains a tracked post-freeze improvement for
  raising the cap.
- **Evidence:** `PHASE-2-BACKEND-MIGRATION.md` §3 table; commit `b928cbe`.

## 6. Ella scoring accuracy

- **Original problem:** doubts about whether Ella's scores match the HR
  standard.
- **Fix implemented:** no scoring logic changed this release. Benchmark now
  prepared: role **ME02 (Mechanical Engineer)**, **30 resumes screened by Ella**
  on 2026-08-31, a 15-candidate benchmark sheet pre-filled with Ella's output
  (`ella-scoring-benchmark-ME02.csv`), and 4 discrepancy hypotheses (H1–H4)
  documented in `ELLA-SCORING-BENCHMARK.md`.
- **Test performed:** Ella side done; HR manual-score column outstanding.
- **Preliminary observation:** Ella did not score any candidate above 49/100,
  including a 10-yr powertrain engineer and an 8-launch product-dev manager —
  possible top-of-range compression (hypothesis H1). Recommendation was always
  "For HR Review" (H2). Clear non-matches scored correctly low (H3).
- **Expected result:** mean absolute score delta ≤ 10/100, recommendation
  agreement ≥ 80%, no opposite-direction mismatches, no hallucinated evidence.
- **PASS / FAIL:** **BLOCKED** — on HR filling the 15 `hr_*` rows.
- **Evidence:** `ella-scoring-benchmark-ME02.csv` (Ella side complete).
