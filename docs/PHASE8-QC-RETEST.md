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
- **Known limitation:** the intake pipeline runs inline in the request with no
  `maxDuration` set — batches over ~8 files risk a client-visible timeout even
  though dispatched files still finish (see `BATCH-CAPACITY-VALIDATION.md`).
- **Test performed:** _(Worksheet B / Phase 7 row 29)_
- **Expected result:** batches of ≤ 8 complete within the processing window with
  no duplicate n8n executions; larger batches degrade predictably (timeout on
  the HTTP response, not data loss).
- **Actual result:** ___
- **PASS / FAIL:** ___  (note: PASS is conditional on the ≤ 8 recommendation
  being adopted or `maxDuration` being set)
- **Evidence:** ___

## 6. Ella scoring accuracy

- **Original problem:** doubts about whether Ella's scores match the HR
  standard.
- **Fix implemented:** no scoring logic changed this release; benchmark tooling
  and the exact scoring-field model documented (`ELLA-SCORING-BENCHMARK.md`,
  `scoring-benchmark-template.csv`).
- **Test performed:** _(BLOCKED — needs 8–12 HR-scored resumes + rubric
  confirmation)_
- **Expected result:** mean absolute score delta ≤ 10/100, recommendation
  agreement ≥ 80%, no opposite-direction mismatches, no hallucinated evidence.
- **Actual result:** ___
- **PASS / FAIL:** ___  (currently **BLOCKED**)
- **Evidence:** ___
