# Pilot validation session — 2026-09-02

Scope for the day per operator instruction. **Explicitly skipped:** OpenAI API
key / live Ella Help LLM testing; OneDrive / Microsoft Entra integration.

This session had **no live pilot access** (no browser, OAuth, phone, calendar,
Vercel/Neon/n8n consoles). Everything below is either **code-path verification**
or **documentation work**. Items needing the deployed environment are marked
**BLOCKED / MANUAL** and carried forward.

Automated gate re-run at HEAD `ada242d`:

| Check | Result |
| --- | --- |
| `tsc --noEmit` | ✅ 0 errors |
| `node --test tests/*.test.mjs` | ✅ 171 / 171 pass |

No code changed this session — automated gate is a regression baseline only.

---

## 1. Google Drive multi-file upload

| Check | Status | Evidence |
| --- | --- | --- |
| Connect / OAuth / token store | PASS (code-path) · live PASS 2026-08-31 | `google-drive.ts`, `auth/google-drive/*`; `DRIVE-E2E-VALIDATION-2026-08-31.md` |
| Folder browsing | PASS (code-path) | `drive/list/route.ts` — `files.list`, breadcrumb walk, `allDrives`, RESUME_EXT filter |
| Multi-select + 1/2/5/8 import | PASS (code-path) · live 2-file PASS 2026-08-31 | `DriveFilePicker.tsx`, `drive/import/route.ts` → `intakeResumeBatch` |
| > 8 files blocked | PASS (code-path) | `fileIds` zod `.max(MAX_FILES_PER_SUBMISSION=8)` → 422; UI cap in `BulkResumeScreeningPanel.tsx` |
| Invalid / non-resume rejected | PASS (code-path) | `RESUME_EXT` filter + Google-native mime reject in list and import |
| Duplicate skipped, not re-charged | PASS (code-path) · live PASS 2026-08-31 | same-batch `claimedInBatch`; cross-batch `storeResumeFile` `reused` → `Skipped`, no `recordDeduction` |
| Same pipeline as local upload | PASS (code-path) | identical `intakeResumeBatch` helper, `sourceLabel:"Portal Drive Import"` |
| 1 credit per successful file | PASS (code-path, mechanical) · live PASS 2026-08-31 | `assertCreditsAvailable(N)` then `recordDeduction("cv_analysis",1)` per accepted file |
| Failed / skipped consume 0 credits | PASS (code-path) | per-item try/catch → `Failed` row + stored-copy delete, no deduction |
| No stuck `Processing` rows | BLOCKED / MANUAL | needs live `Bulk_Resume_Queue`; R1 investigation closed non-blocking |
| Full happy-path completion via n8n | BLOCKED / MANUAL | 2026-08-31 run: test resumes failed n8n contact-info gate (no intl mobile); need a passing test resume |

**No defect found. No redesign.**

## 2. Batch-capacity validation

- Cap constants unchanged: `MAX_FILES_PER_SUBMISSION = 8` (local + Drive),
  `MAX_FILES_PER_BATCH = 25` (worker pool / OneDrive only, unpublished).
- Code-derived in-request time ≈ `(N−2)×10 s` staggered pool → worst case at
  N=8 ≈ 60–75 s, inside any reasonable budget. Per-file webhook bounded 60 s.
- 1 / 2 / 5 / 8 timed live run with processing time, per-file outcome, n8n
  errors, queue status, credit deltas: **BLOCKED / MANUAL** (Worksheet B).
  Prior 2/5/8 run (2026-08-31) all `202`, no timeout, no orphans.
- **Verdict: 8 remains a safe pilot limit** on the code evidence. Cap not
  increased.

## 3. Postgres dual-write / backend health

| Check | Status |
| --- | --- |
| `CREDITS_BACKEND=dual`, not flipped | ✅ confirmed unchanged (`ella-credits.ts:29`) |
| Divergence check is fresh-vs-fresh | PASS (code-path) — `getCreditBalance({fresh:true})` gate at `ella-credits.ts:65`; deduction + top-up both read fresh |
| Mirror-write failure isolated | PASS (code-path) — `mirrorToPostgres` catch logs, Sheets stays authoritative |
| Sheets vs Neon balance / ledger / Entry_ID parity | BLOCKED / MANUAL — needs Neon + Sheet; last live check 2026-08-31 in sync (7 == 7 == 7, 16 rows) |
| `[Credits] Divergence` / `Postgres mirror write failed` in recent logs | BLOCKED / MANUAL — needs Vercel log window |
| Zero-divergence soak progressing | BLOCKED / MANUAL — 24–48 h clean `dual` window still to be observed since the detector fix |

**No divergence to report** (none observable this session). Nothing changed.

## 4. Live RBAC UAT

Code-path verification of the deployed model:

| Tier | Expectation | Code-path |
| --- | --- | --- |
| HR (`canReviewRole`) | company-wide view + manage + applicant decisions + AI dept | `filterVisibleRoles`/`filterVisibleApplicants` return all; `canManagePipeline`, `canDecideApplicant` true |
| Management (`canApproveRole`) | company-wide VIEW-ONLY | sees all in filters; `canManagePipeline`/`canEditRecruitmentSetup`/`canEditApplicant`/`canDeleteApplicant`/`canDecideApplicant` all **false**; role status route `permission:"review"` → `canReviewRole` only, so no approve/reject/return/hold; no bulk-screen / invite / slot (all `canManagePipeline`) |
| HOD (`canReviewDepartmentRole`) | own dept only, read-only, no decisions | `isDepartmentReviewer` + `sameDepartment` filter; no manage/decide caps |
| Creator-only (`canCreateRole` only) | own requisitions only, no applicant access | `isCreatorOnly` filter by `requesterEmail`; `filterVisibleApplicants` → `[]`; `/api/applicants/recent` 403 |

UI + API both enforced (decision route `canDecideApplicant`; status route
`canReviewRole`; recent-applicants route tier gate). **Live click-through with
real accounts of each tier: BLOCKED / MANUAL.**

## 5. New Applicant notification UAT

New feature (`ada242d`) code-path:

| Check | Status |
| --- | --- |
| HR company-wide new applicants | PASS (code-path) — `/api/applicants/recent` uses `filterVisibleApplicants` |
| Management sees notifications, stays read-only | PASS (code-path) — feed allowed for `canApproveRole`; no action caps |
| HOD own-department only | PASS (code-path) — `filterVisibleApplicants` dept filter |
| Creator-only has no bell | PASS (code-path) — `AppShell` `showApplicants` false; route 403 |
| Count correct / dropdown links / NEW badge | PASS (code-path) — `isNewApplicant` vs localStorage watermark; `ApplicantsList` NEW pill |
| Opening `/applicants` clears watermark; later applicant re-flags NEW | PASS (code-path) — `writeApplicantsLastSeen` on list mount; bell re-reads on navigation |
| No duplicate polling | PASS (code-path) — single 60 s interval, paused when tab hidden, `focus` refresh |
| Historical demo rows excluded | PASS (code-path) — `isHistoricalDemo` guard in lib + route |
| Live multi-account behaviour | BLOCKED / MANUAL |

**Known pilot limitation (documented):** read/new state is in `localStorage`,
so it is per browser / per device — recorded in `new-applicants.ts` header and
now in the User Manual.

**Gap (not a defect):** `src/lib/new-applicants.ts` has no dedicated unit test.
Recommend adding one for `applicantAppliedTime` / `isNewApplicant` — not done
this session (conservative change policy; no confirmed defect).

## 6. Ella AI scoring benchmark package — READY FOR HR

- `ELLA-SCORING-BENCHMARK.md` + `ella-scoring-benchmark-ME02.csv`: role ME02,
  15 candidates, Ella scores pre-filled, HR columns blank, H1–H4 hypotheses.
- Added this session: sample-size guidance (HR scores a representative 8–12),
  and a **voice-interview scoring comparison** section + template
  (`voice-scoring-benchmark-template.csv`) — communication quality, answer
  completeness, per-role interview eval fields, overall voice score /
  recommendation, question-mapping + score-validity checks.
- ME02 has **no completed voice interviews** for benchmark candidates → voice
  comparison prepared but not yet actionable for ME02.
- HR can now score and compare without developer help. No scoring logic touched.

## 7. Remaining live E2E

Voice interview, F2F interview, credits E2E, notification/email delivery —
all covered by the automated contract suite (171 tests) at the code-path level;
**every item needing a real phone call, OAuth, calendar event, HR action or
elapsed time is BLOCKED / MANUAL.** See `RELEASE-VALIDATION-STATUS.md` Phase 7/8
checklists — unchanged.

## 8. User Manual — UPDATED

`McLink-Recruitment-Portal-User-Manual.html` bumped to v1.1 (2026-09-02, Pilot).
Corrected against current deployed behaviour:

- Removed the **Management-approval workflow step** and the **"Pending
  Management Approval"** status (retired — HR approves/rejects directly from
  "Pending HR Discussion"; `status-actions.ts`, status route).
- **Management** role card rewritten as company-wide **view-only** with the full
  list of what it cannot do; **Department Head** clarified as own-department
  read-only.
- Bulk upload **25 → 8** files per batch; added the 1-credit-per-successful-file
  / no-charge-on-skip-or-fail rule.
- Google Drive section: **Connect / Choose from Google Drive** (not "Upload
  from"), same pipeline + dedupe + credit rule, 8-file cap, **OneDrive stated
  as not available**.
- New **"About this pilot version"** callout summarising the RBAC + limits.
- Added **new-applicant notifications** subsection (with the per-device
  localStorage limitation) and an **Ella help assistant** subsection (noting it
  may still reply "being configured" during the pilot).
- Added **voice interview** and **face-to-face interview (venue/address in the
  invite + on the completed booking)** subsections.

⚠️ `McLink-Recruitment-Portal-User-Manual.pdf` is now **stale** vs the HTML —
regenerate from the updated HTML before distributing.
