# Release validation status

Generated during the autonomous phase run. Covers Phases 2, 3, 5, 6, 7, 8.
Phase 4 (docs / AI support bot) and OneDrive live validation are **intentionally
deferred**, not failed.

Automated gate (re-run after the 8-file cap, HEAD includes
`tests/bulk-batch-cap.test.mjs`):

| Check | Result |
| --- | --- |
| `tsc --noEmit` | ✅ 0 errors |
| `eslint src tests` | ✅ 0 errors (8 pre-existing warnings, none from this work) |
| `node --test tests/*.test.mjs` | ✅ **160 / 160 pass** (+7 batch-cap tests) |
| `next build` | ✅ exit 0 |

**Pre-freeze mitigation applied — temporary 8-file cap.** Local upload and
Google Drive import now hard-cap at `MAX_FILES_PER_SUBMISSION = 8` (UI + server
`422`). `MAX_FILES_PER_BATCH = 25` and the worker pool are unchanged — the cap
is a one-line raise once dispatch moves off-request. OneDrive left at 25
(deferred). `maxDuration` was deliberately **not** added as the sole fix. See
`BATCH-CAPACITY-VALIDATION.md`.

---

## Phase 3 — STEP 1: Google Drive live validation

**Update (2026-08-31):** Google Drive live **OAuth is confirmed working** on the
deployed pilot — account connected, "Choose from Google Drive" available. The
connection issue is **resolved**. Remaining: the 2-file import E2E + dedupe +
credit + webhook + dual-write checks — run **Worksheet A** in
[LIVE-VALIDATION-WORKSHEETS.md](LIVE-VALIDATION-WORKSHEETS.md) and paste results.

**The import E2E still needs an operator** (browser + Vercel/n8n/Neon
visibility). What follows is a **code-path verification** of every checklist
item; the operator steps are in Worksheet A.

| Checklist item | Code-path status | Where |
| --- | --- | --- |
| Connect Google Drive | ✅ `GET /api/auth/google-drive/connect` → `getDriveConsentUrl(user.email)`, HR-gated, rate-limited | `google-drive.ts`, connect route |
| OAuth consent succeeds | ✅ `access_type=offline`, `prompt=select_account consent`, signed state (`createOAuthState`) | `getDriveConsentUrl` |
| Account-mismatch guard | ✅ `DriveAccountMismatchError` if token email ≠ connecting user | `exchangeDriveCodeAndStore` |
| Folder/file browsing | ✅ `GET /drive/list` — `files.list` with folder+`.pdf`/`.doc` query, breadcrumb walk, `allDrives` | `drive/list/route.ts` |
| Multi-file selection | ✅ picker caps at 25, selection Set | `DriveFilePicker.tsx` |
| PDF/DOC/DOCX only | ✅ `RESUME_EXT` filter in list + import; Google-native (`application/vnd.google-apps.*`) rejected | list + import routes |
| Server-side download | ✅ `files.get({alt:"media"}, {responseType:"arraybuffer"})` in `getBytes()` | `drive/import/route.ts` |
| Into existing `intakeResumeBatch` | ✅ same helper as local upload, `sourceLabel:"Portal Drive Import"` | `drive/import/route.ts` |
| Filename / source metadata | ✅ `source.name` → `storeResumeFile` filename; `driveFileId` carried; payload `source` field | `bulk-resume-intake.ts` |
| Dedupe (SHA-256 + role) | ✅ same-batch `claimedInBatch`; cross-batch via `storeResumeFile` `reused` + queue lookup | `bulk-resume-intake.ts` |
| 1 credit per CV | ✅ `assertCreditsAvailable(N)` pre-check; `recordDeduction("cv_analysis",1)` per accepted file | `bulk-resume-intake.ts` |
| Queue creation | ✅ `appendBulkResumeQueueEvent` `Processing` row before webhook, per file | `bulk-resume-intake.ts` |
| Webhook execution | ✅ `bulk_resume_uploaded` POST, `X-Webhook-Secret` + `X-Idempotency-Key: queueId` | `bulk-resume-intake.ts` |
| Progress / status | ✅ 202 with `results`/`batchId`/`submitted`/`creditsCharged`; panel polls `/bulk?roleId=` every 60 s | panel + GET route |
| Partial failure handling | ✅ per-item `try/catch` → `Failed` queue row + stored-copy delete; batch continues; rejected-metadata merged into results | import route + helper |
| Duplicate retry behaviour | ✅ re-import of same bytes → `Skipped` ("already screened / queued"); no credit charged | `bulk-resume-intake.ts` |
| Insufficient credits | ✅ `EllaCreditsError` → **402** `{code,required,available}`, nothing dispatched | import route |
| Notification behaviour | ✅ `bulk_resume_batch_complete` only when enabled + all-terminal + not UAT | `bulk-resume-intake.ts` |
| Sheets/Postgres dual-write | ✅ `recordDeduction` → `ella-credits.ts` dispatcher; `CREDITS_BACKEND=dual` writes Sheets (authoritative) then mirrors to Postgres with divergence logging | `ella-credits.ts`, `ella-credits-postgres.ts` |

### Operator steps for the live run (small safe batch first — 2 files)

1. Resume Screening → **Connect Google Drive** → consent as an HR user → expect
   redirect back with `?drive=connected` and the connected account shown.
2. **Choose from Google Drive** → open a folder with 2 test PDFs → select both →
   **Import 2 files**.
3. Expect: `202`, two `Bulk_Resume_Queue` rows, credits meter −2, status table
   reaching *Completed* within the n8n processing window.
4. Re-import the same 2 files → expect both **Skipped**, meter unchanged.
5. Import 1 valid + 1 corrupt/empty PDF → expect 1 *Completed*, 1 *Failed*, no
   half-charged credits (only the accepted file is deducted).
6. Temporarily set the org credit balance below the batch size → import →
   expect **402**, no queue rows, no deduction.
7. In Vercel logs during/after: confirm **no** `[Credits] Divergence` and **no**
   `Postgres mirror write failed` lines. In Neon: `SELECT balance FROM
   credit_balance WHERE id=1` equals the Sheet `Ella_Credit_Ledger` running
   balance.

**If a defect appears:** fix only that defect, re-run the affected automated
test(s), then re-run `tsc` / `eslint` / `build`. Do not refactor beyond the fix.

---

## Phase 5 — Batch capacity — MITIGATED

See [BATCH-CAPACITY-VALIDATION.md](BATCH-CAPACITY-VALIDATION.md).

- Code-derived: the request handler runs the staggered pool inline
  (≈ `(N−2)×10 s`), so large batches risk a client-visible timeout.
- **Mitigation shipped:** hard cap of **8 files/submission** for local upload and
  Google Drive import, UI + server (`422`). `MAX_FILES_PER_BATCH = 25` and the
  worker pool are untouched. `maxDuration` deliberately not the sole fix.
- OneDrive: **Deferred / Not validated**, left at 25.
- Real fix (roadmap): move dispatch off-request, then re-measure and raise the
  cap.
- Empirical numbers still need a live run (Worksheet B) — but with an 8-cap the
  worst case is ~60–75 s in-request, well inside any reasonable budget.

---

## Phase 6 — Ella AI-scoring validation

See [ELLA-SCORING-BENCHMARK.md](ELLA-SCORING-BENCHMARK.md) +
[scoring-benchmark-template.csv](scoring-benchmark-template.csv).

- **Manual benchmark step: BLOCKED** — needs 8–12 HR-scored resumes for one role
  plus confirmation of the intended rubric/weights.
- Template, procedure, analysis metrics, and suspected-cause taxonomy are ready.
- No scoring logic changed in this release; scoring path compiles/lints/builds
  clean; question-mapping regression covered by the automated suite.

---

## Phase 7 — Full regression (automated portion)

Automated suite = **153/153 pass**, covering (see `tests/`): auth/session,
RBAC & route protection, role creation, recruitment setup, simplified approval
(management-approval removal), candidate application & intake fields, local
resume upload bounds, Google Drive import + shared-helper contract, OneDrive
source-level contract, single & bulk screening, duplicate detection, credit
deductions & insufficient-credit 402, pricing/volume-discount, dual-write
mechanism, post-screening notification outcomes, AI interview booking, F2F venue
field, voice interview capacity, missed-call / No-Show reconciliation, canonical
question mapping, calendar booking token single-use, form persistence, rate
limiting.

**Manual regression (login/SSO click-through, live n8n latency, real calendar
booking, transcript generation, end-to-end AI phone interview, 3-attempt
lifecycle) needs a human tester on the deployed instance** — checklist below in
"Remaining UAT blockers".

---

## Phase 8 — Formal QC retest of the six original blockers

Each was addressed in commit `c038823` (URS Phase 1) / earlier. **PASS/FAIL with
evidence requires the live retest** — status is "fix in place, evidence pending".

| # | Blocker | Fix implemented | Test to perform | Expected | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Post-screening notifications | Notification outcomes decoupled from workflow success; `bulk_resume_batch_complete` only on all-terminal + enabled | Screen a batch with notifications enabled; check HR/mgmt inbox | Completion email received; screening unaffected if email fails | fix in place; evidence pending |
| 2 | F2F interview address | Venue/address field added to F2F interview scheduling | Book an F2F interview, set a venue | Venue persists and appears in invite | fix in place; evidence pending |
| 3 | Ella summary misattribution | Canonical numbered-question set; summary maps answers by index | Run a voice interview, open the summary | Each answer under its correct question | fix in place; **automated** question-count guard passes |
| 4 | Candidate no-show handling | 3-attempt lifecycle scaffolding; past booked interviews reconcile to No Show without overwriting completed results | Let a booked slot lapse | Row → No Show; completed results untouched; attempt counter advances | fix in place; **automated** reconciliation test passes |
| 5 | n8n / system latency | New pilot workflows only; webhook `X-Idempotency-Key`; concurrency 2 + 10 s stagger; **8-file cap** bounds in-request time to ~60–75 s | Time an ≤8 batch through n8n | Within processing window; no dup executions | timeout risk **mitigated** by the cap; live timing evidence pending |
| 6 | Ella scoring accuracy | No logic change this release; benchmark tooling prepared | Phase 6 benchmark vs HR scores | Deltas within tolerance | **BLOCKED** on HR scores |

R1 (Bulk_Resume_Queue "stuck Processing") — **closed, non-blocking**. See
`R1-BULK-QUEUE-PROCESSING-INVESTIGATION.md`.

---

## Database — dual-write watch

- `CREDITS_BACKEND=dual` (unchanged). **Not switching to `postgres` without
  explicit approval.**
- **Read-only check done 2026-08-31** (`LIVE-VALIDATION-RESULTS-2026-08-31.md`):
  Neon `credit_balance` = 0, ledger sum 0, 4 rows; Sheet `Ella_Credit_Ledger`
  sum 0, last balance 0; per-entry deltas identical. **Stores are in sync.**
- Still missing: Vercel-log confirmation of zero `[Credits] Divergence` /
  `Postgres mirror write failed` over a 24–48 h `dual` window.
- **Cutover-safe when** that log window is clean AND one real top-up + one real
  ≤8 bulk screening have round-tripped in production.

---

## Code Freeze readiness

| Gate | State |
| --- | --- |
| Assistant-authored code (Phases 1–3, dual-write, 8-file cap, credit F1/F2, webhook timeout) | ✅ tsc / eslint / 164 tests / build all green |
| **Phase 2 — backend + performance** | ✅ **COMPLETE WITH PILOT MITIGATION** — migration + dual-write live-reconciled; n8n mitigated (concurrency + stagger + 8-file cap + 60 s webhook bound); perf verification 2/5/8 all `202`, no timeout, no orphans. See `PHASE-2-BACKEND-MIGRATION.md` §7 |
| R1 (queue Processing) | ✅ closed, non-blocking (investigation doc) |
| Batch-capacity timeout risk | ✅ mitigated — 8-file cap + 60 s per-file webhook bound (server + UI + tests) |
| Google Drive connect / OAuth / token store | ✅ verified via `Drive_Connections` |
| Google Drive import E2E | ✅ cap, import, metadata, dedupe-collapse, unreadable-file, **Screened happy path**, **cross-batch dedupe (not re-charged)** all PASS (2026-08-31 perf run) |
| Credit deduction on failed screening (F1/F2) | ✅ fixed + live-validated |
| Dual-write soak | ⏳ needs Vercel log window; stores reconcile live (11 == 11) |
| Deployment/domain mismatch (finding D2) | ✅ resolved — canonical URL aligned |
| Phase 6 scoring | ⛔ blocked on HR scores (not a freeze blocker — scoring unchanged this release) |
| Phase 7 manual regression | ⏳ operator checklist |
| Phase 8 QC evidence | ⏳ operator checklist |

**Recommendation:** the code is freeze-ready. Remaining items are
operator-executed validation, not code changes. Freeze the branch; run the
[short manual checklist](MANUAL-CHECKLIST.md); lift to production once Worksheet A
+ the dual-write log window are clean.
