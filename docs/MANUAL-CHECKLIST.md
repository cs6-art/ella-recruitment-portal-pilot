# Remaining manual checklist

Everything code-side is done and green. These five items need a human on the
deployed pilot. Ordered by what unblocks Code Freeze → production.

---

## 1. Vercel dual-write soak confirmation  ·  ~5 min + a wait

1. Vercel → project `ella-recruitment-portal-pilot` → **Logs** → filter `Credits`.
2. Over any **24–48 h** window of normal use, confirm **zero** lines containing
   `[Credits] Divergence` or `Postgres mirror write failed`.
3. Do one real **top-up** (Settings → Ella Credits, +5) and one real **≤8-file
   bulk screening**. After each, check the filter again.
4. Paste the filtered log output (or "clean, 0 matches, <dates>") back.

✅ = clears the last gate for recommending `CREDITS_BACKEND=postgres`.
(Stores already reconcile: Neon balance == Sheet balance == 0 as of 2026-08-31.)

---

## 2. Google Drive live import evidence  ·  ~10 min

On `ella-recruitment-portal-pilot.vercel.app`, signed in as an HR user:

1. Resume Screening → pick a published role → **Choose from Google Drive** →
   select **2** PDFs → Import.
2. Confirm: 2 rows reach **Completed**; credits meter **−2**; re-importing the
   same 2 → both **Skipped**, meter unchanged.
3. Import 1 valid + 1 empty/corrupt PDF → 1 Completed, 1 Failed, meter **−1**.
4. Screenshot the status table + the `Ella_Credit_Ledger` rows.

Also confirm the **8-file cap**: try to select a 9th file → blocked with a
message.

Full table: `LIVE-VALIDATION-WORKSHEETS.md` → Worksheet A.

---

## 3. HR scoring benchmark  ·  HR effort, ~2–3 h

HR provides, for **one published role**, **8–12 resumes** across Reject/Hold/
Proceed, each with:

- the resume file
- HR overall score 0–100, recommendation (Proceed/Hold/Reject)
- HR strengths + concerns (bullets)
- an HR sub-score for **each evaluation criterion toggled on for that role**
- confirmation the role's written screening criteria are the intended standard

Enter one row per candidate in `scoring-benchmark-template.csv`. Then the
comparison runs automatically (`ELLA-SCORING-BENCHMARK.md` → Analysis).

Not a Code Freeze blocker — scoring logic is unchanged this release.

---

## 4. Phase 7 manual regression  ·  ~1–2 h

Run `PHASE7-MANUAL-REGRESSION.md` (33 rows). Mark PASS/FAIL + evidence.

Minimum subset to clear freeze → production:
rows **1–2** (login/SSO), **3–4** (RBAC), **7** (no management-approval step),
**9** (local upload), **10** (Drive import — from item 2 above), **13**
(dedupe), **16** (Sheet balance == Neon), **27** (calendar token single-use).

The rest (AI phone interview, 3-attempt lifecycle, transcripts) can complete
during the UAT window with a real phone participant.

---

## 5. Phase 8 QC evidence  ·  folds into items 2 + 4

Fill `PHASE8-QC-RETEST.md` — one section per original blocker:

| # | Evidence source |
| --- | --- |
| 1 Notifications | item 2 batch → HR/mgmt inbox screenshot |
| 2 F2F venue | book an F2F interview, screenshot the invite showing the venue |
| 3 Summary mapping | open any completed voice-interview summary, confirm answers under correct questions |
| 4 No-show | let a booked test slot lapse → confirm row flips to No Show, attempt counter +1 |
| 5 Latency | item 2 batch timing + n8n execution count (no duplicates) |
| 6 Scoring | item 3 (blocked until HR scores land) |

Mark PASS only with an attached artefact.

---

## Also outstanding (operator, not a test)

- **Finding D2:** `NEXT_PUBLIC_APP_URL` / `ella-recruitment.mclinkgroup.com`
  currently serves a build **without** Phase 3 (returns 404 for the Drive
  routes). Confirm the canonical pilot URL and align `NEXT_PUBLIC_APP_URL`, the
  custom domain, and the Google OAuth redirect URI to the Phase-3 deployment.
- **R1 cleanup (optional, non-blocking):** append terminal events for the 10
  stale `Processing` rows, or ship `reconcileBulkResumeQueue` +
  `/api/cron/reconcile-bulk-queue` (see `R1-BULK-QUEUE-PROCESSING-INVESTIGATION.md`).
