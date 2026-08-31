# Google Drive import — live E2E validation, 2026-08-31

Run by the assistant against the deployed pilot
`https://ella-recruitment-portal-pilot.vercel.app` using an HR session
(`cs6@mclinkgroup.com`, provided out-of-band), read access to Neon + Google
Sheets, and the connected Drive account's existing test folder. `CREDITS_BACKEND`
left on `dual`. All test credits topped up and reversed — ledger restored to 0.

## Environment

- Session: `GET /api/session` → 200, `cs6@mclinkgroup.com`, HR, `canReviewRole`.
- Drive: `GET /api/auth/google-drive/status` → `connected:true`, `cs6@`, since
  2026-08-31T05:09:38Z.
- Test files: folder **"Resume/CV for Testing"** → `Jose.pdf`, `Juleane.pdf`
  (both `application/pdf`). No fresh/valid-screenable file and no corrupt file
  available — the connected token is `drive.readonly` and the service account
  has `canAddChildren:false` on that folder, so the assistant could not upload
  more.
- Target role: `ME02` (Mechanical Engineer, Job Posted) — accepted for intake.

## Results

| # | Step | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | **8-file selection cap** | ✅ **PASS** | `POST /drive/import` with 9 fileIds → `422 "Select 1 to 8 files and a published role."` — rejected before any Drive call. |
| 2 | **2-file import → queue rows + metadata** | ⚠️ **PARTIAL** | `POST /drive/import` (Jose + Juleane) → `202`. Both files downloaded server-side, stored, webhooked. Queue rows created for both with **filenames preserved** (`Jose.pdf`, `Juleane.pdf`), `environment: production`, real `jobId` (`BULK-ME02-<sha256>`), extracted candidate name/email (`JOSE Z. PEREZ JR.` / `perezjrjose90@gmail.com`). **BUT both reached `Failed`, not `Completed`** — n8n rejected them: *"Candidate name, email, or international mobile number was not found in the resume."* The test resumes have no international mobile number. Happy-path completion is therefore **not validated** — no available test file can pass the current screening contact-info gate. |
| 3 | **Exactly 2 credits deducted** | ✅ **PASS (mechanically)** | Balance 5 → 3. Two `cv_analysis −1` ledger entries, references = the two `BULK-ME02` queueIds. `creditsCharged: 2` in the response. |
| 4 | **Sheet ↔ Postgres balance sync** | ✅ **PASS** | After every operation Neon `credit_balance` == Sheet last `Balance_After`, and Neon `sum(credits_delta)` == Sheet `sum(Credits_Delta)`. Verified at: baseline (0/0), after +5 topup (5/5), after −2 (3/3), after −1 (2/2), after −2 reversal (0/0). Mirror lag 0.2–1.2 s. 9 ledger rows, both stores identical. |
| 5 | **Duplicate fileIds in one request** | ✅ **PASS** | `POST /drive/import` with `[Jose, Jose]` → route collapses via `new Set()` → **1** result, `creditsCharged: 1`, `concurrency: 1`. No double charge. |
| 6 | **Unreadable / invalid file** | ✅ **PASS** | `POST /drive/import` with a bogus fileId → `202`, result `Failed: "That file could not be read from Google Drive."`, `creditsCharged: 0`, `batchId: ""`, no queue row, batch not aborted. |
| 7 | **Cross-batch dedupe of a Screened file** | ⛔ **NOT VALIDATED** | Requires a resume that reaches `Screened`. None available (see #2). A `Failed` file is *not* dedupe-skipped by design (it is retryable) — re-importing Jose re-processed and re-charged, as expected for the retry path. |
| 8 | **Corrupt / empty PDF fails during extraction, 0 credits** | ⛔ **NOT VALIDATED** | No corrupt file could be placed in the folder (`drive.readonly` + SA has no write). Covered *indirectly* by #6 (unreadable file → clean fail, 0 charge). |

## Credit balance

| Point | Balance | Ledger rows | Sum |
| --- | ---: | ---: | ---: |
| Before test | 0 | 4 | 0 |
| After operator top-up +5 | 5 | 5 | 5 |
| After 2-file import (−1, −1) | 3 | 7 | 3 |
| After duplicate-fileId import (−1) | 2 | 8 | 2 |
| After assistant reversal −2 | **0** | 9 | 0 |

Net ledger effect of the whole test: **0**. Both stores in sync at every step.

## Findings

### Live re-validation of the F1 fix — 2026-08-31 (post-deploy, commit `5a61973`)

Re-imported the same two synchronously-failing files (`Jose.pdf`, `Juleane.pdf`)
into `ME02` after the fix deployed. Operator topped up +2; test consumed 0;
reversed −2 → ledger back to 0.

| Assertion | Before | After | Result |
| --- | --- | --- | --- |
| Both files return `Failed` | — | Jose `Failed`, Juleane `Failed` | ✅ |
| Response `creditsCharged` | (was 2) | **0** | ✅ |
| Response `submitted` | — | 0 (consistent) | ✅ |
| Sheet credit balance | 2 | 2 | ✅ unchanged |
| Neon `credit_balance` | 2 | 2 | ✅ unchanged |
| Sheet ledger rows | 10 | 10 | ✅ no new rows |
| Neon ledger rows | 10 | 10 | ✅ no new rows |
| `cv_analysis` rows (both stores) | 4 | **4** | ✅ no new deductions |
| Sheet ↔ Neon sync | OK | OK | ✅ |
| Queue rows | — | Jose + Juleane `Failed` with *"Candidate name, email, or international mobile number was not found in the resume."* | ✅ correct |

**F1 and F2 are live-validated. Both fully closed.**

### F1 — Files that fail screening were charged 1 credit  ·  MEDIUM  ·  **FIXED + LIVE-VALIDATED**

Both test resumes reached `Failed` (n8n rejected them for a missing
international mobile number) yet each consumed 1 credit. In
`intakeResumeBatch.processItem` the deduction ran immediately after the webhook
returned HTTP 2xx, **before** the workflow's `status` in that same response was
read.

The n8n intake contract (`integrations/n8n/bulk-resume-upload-intake.ts`)
confirms the workflow **responds synchronously with the terminal status** —
`Screened` when a scored result was saved, `Failed` when the resume was rejected
before a result (unreadable, missing contact details), `Skipped` for a
duplicate.

**Fix (commit — `bulk-resume-intake.ts`):** read the workflow status first;
skip `recordDeduction` when the synchronous response is `failed` or `skipped`.
`Screened` / `Processed` / `Queued` (async accept) still charge. One Ella Credit
now buys a completed CV analysis, not an attempt.

- Remaining gap (documented in code, not fixed here): a resume accepted for
  **asynchronous** screening that later fails is not auto-refunded — needs a
  reconciliation sweep, tracked with the R1 queue-reconcile follow-up.
- Regression test: `tests/bulk-resume-upload.test.mjs` →
  *"a resume the workflow rejects synchronously is not billed"*.

### F2 — Response reported `submitted: 0` with `creditsCharged: 2`  ·  LOW  ·  **RESOLVED by F1 + LIVE-VALIDATED**

For an all-failed batch the API returned `submitted: 0` but `creditsCharged: 2`.
Post-fix live re-check: an all-synchronously-failed batch returns
`creditsCharged: 0` and `submitted: 0`, so the panel summary and the credits
meter agree.

### F3 — The designated test folder cannot exercise the happy path  ·  BLOCKER for full validation

"Resume/CV for Testing" contains only resumes that fail the current screening
contact-info gate (no international mobile number). To validate
Screened-completion, dedupe of a screened file, and the completion notification,
a test resume with **name + email + international-format mobile** must be added.

### F4 — n8n is reachable and processing synchronously from the pilot

Each webhook call returned a terminal `status` within the request (n8n ran the
screening inline and answered `failed`). One webhook call per file, one queue
`Processing`→`Failed` transition per file, distinct `batchId` per import. **No
duplicate executions observed.** Full n8n execution-log confirmation still needs
n8n API access.

## Dual-write / Postgres cutover

**Dual-write is clean.** Across 1 top-up, 3 deductions and 1 adjustment on
2026-08-31, Neon and the Sheet stayed byte-identical (same rows, deltas,
balances) and the balance returned exactly to 0. This is the strongest evidence
yet that `dual` mode is faithful under real writes.

**Still outstanding before recommending `CREDITS_BACKEND=postgres`:** operator
confirmation that Vercel logs show **zero** `[Credits] Divergence` /
`Postgres mirror write failed` over a 24–48 h window. The assistant has no Vercel
log access. Do **not** switch without explicit approval.

## Is Google Drive Phase 3 fully validated?

**No — partially.** Validated: connect/OAuth/token store, the 8-file cap,
server-side download into the shared intake pipeline, filename/source metadata,
credit deduction mechanics, dual-write consistency, duplicate-fileId collapse,
and clean handling of an unreadable file. **Not validated:** a resume reaching
`Screened`, cross-batch dedupe of a screened file, the completion notification,
and the corrupt-PDF extraction-failure path — all blocked on test-data, plus F1
needs an n8n-side decision.

## Test artifacts left in production (minor)

- `Bulk_Resume_Queue` (ME02): 3 `Failed` rows — batches `BATCH-20260831064559-C2559AFC`
  and `BATCH-20260831065321-0A2BB727`.
- `High_Match_Profile`: applicant rows `APP-dcf75efc15edafb5bb512c45` (Jose),
  `APP-d7e94896970254b7deb2e92d` (Juleane) — `Failed`, no screening result.
- 3 copied resume files in the resume-storage Drive folder.
- All `Failed`, none will progress. Clean up if desired.

## Also

The `MCLINK_TEST_SESSION` value the operator added to `.env.local` should be
removed and that browser session logged out to revoke the token.
