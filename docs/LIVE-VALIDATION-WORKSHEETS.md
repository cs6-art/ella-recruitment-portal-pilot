# Live validation worksheets

Fill these in on the deployed pilot and paste the completed tables back so the
results can be verified against the code contract. Nothing here can be executed
without the running deployment + browser + Vercel/n8n/Neon visibility.

Keep `CREDITS_BACKEND=dual` throughout. Do not raise any platform limit.

---

## Worksheet A — Google Drive live E2E (2-file safe batch)

Pre: Drive is connected (done). Note the org **credit balance before** you start:
`Settings → Ella Credits` → ______.

| Step | Action | Expected | Observed |
| --- | --- | --- | --- |
| A1 | Resume Screening → pick a published role | role selected | |
| A2 | **Choose from Google Drive** → open a folder → tick **2** PDF resumes → **Import 2 files** | request returns quickly with a success toast; picker closes | |
| A3 | Watch the status table / progress bar | 2 rows appear as *Queued* → *Processing* → *Completed* within the n8n window | |
| A4 | `Bulk_Resume_Queue` sheet | 2 new rows, `Status` progressing, `Batch_Id` identical for both, filenames preserved, `Source` = "Portal Drive Import" | |
| A5 | Credit meter + `Ella_Credit_Ledger` | balance dropped by **exactly 2**; 2 new `cv_analysis` rows, `Credits_Delta = -1` each, `Reference` = the queue id | |
| A6 | n8n pilot workflow executions | 2 executions triggered by `bulk_resume_uploaded`, each with a distinct `X-Idempotency-Key`; no duplicate executions | |
| A7 | Applicants list for the role | 2 new applicants with extracted name/email, match score populated after screening | |
| A8 | Notifications | If `Bulk_Resume_Notify_On_Success` is ON: one completion email to HR/mgmt after both rows terminal. If OFF: no email (expected). | |
| A9 | **Dedupe:** immediately re-import the **same 2 files** | both return **Skipped** ("already screened for this role"); **no** new queue rows; credit balance **unchanged** | |
| A10 | **Partial failure:** import 1 valid PDF + 1 empty/corrupt PDF | valid → *Completed*; corrupt → *Failed* with an error message; balance drops by **1 only** | |
| A11 | **Insufficient credits:** top the balance down to 0 (or below the batch size) → import 2 files | HTTP **402**, message about topping up; **no** queue rows; balance unchanged | |
| A12 | Restore the credit balance you spent for testing | balance back to a working level | |

### Dual-write sync check (after A1–A11)

| Check | How | Expected | Observed |
| --- | --- | --- | --- |
| Sheet balance | last `Balance_After` in `Ella_Credit_Ledger` | == Neon value below | |
| Postgres balance | Neon SQL: `select balance from credit_balance where id = 1;` | == sheet value | |
| Ledger row count | Neon: `select count(*) from credit_ledger;` vs sheet data rows | equal (± rows added since last backfill — should match 1:1 going forward) | |
| Divergence logs | Vercel → project → Logs, filter `Credits` | **no** `[Credits] Divergence`, **no** `Postgres mirror write failed` | |

Paste any `[Credits] …` log lines verbatim.

---

## Worksheet B — Phase 5 batch capacity (2, 5, 8 files)

Use **distinct** resumes per run (so nothing is skipped as a duplicate). Same
published role is fine. Record from the browser Network tab + Vercel function
logs + the queue.

| Metric | 2 files | 5 files | 8 files |
| --- | --- | --- | --- |
| Total upload/request size | | | |
| Time from Import click → HTTP 202 (Network tab, `import` request) | | | |
| Any client error / timeout? (Y/N + status) | | | |
| Vercel function duration (Logs → the `import` invocation) | | | |
| Vercel function peak memory (Logs / Metrics) | | | |
| Function timed out? (Y/N) | | | |
| n8n: all executions triggered? (count) | | | |
| Time from 202 → all queue rows terminal | | | |
| Queue rows created vs files sent | | | |
| Any orphaned `Processing` rows after 30 min? | | | |
| Failures (count + reason) | | | |
| Credits deducted vs files accepted | | | |

**Expected shape from code analysis** (`docs/BATCH-CAPACITY-VALIDATION.md`):
in-request time ≈ `(N−2) × 10 s` — 2 files ~instant, 5 files ~30–45 s, 8 files
~60–75 s. If the 5- or 8-file run returns a client timeout while the queue rows
still complete, that confirms the "no `maxDuration`" finding — **stop increasing
batch size**, report the number, and we decide between adding
`export const maxDuration = 300` or capping the UI at ~8.

OneDrive column: **Deferred / Not validated** — do not run.

---

## Worksheet C — feeds Phase 7 / Phase 8

Results of A and B populate:
- `docs/PHASE7-MANUAL-REGRESSION.md` rows for Google Drive import, bulk
  screening, dedupe, credit deduction, dual-write, notifications.
- `docs/PHASE8-QC-RETEST.md` blocker #1 (notifications) and #5 (latency).
