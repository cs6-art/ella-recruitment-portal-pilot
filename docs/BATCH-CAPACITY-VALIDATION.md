# Phase 5 — Hosting & batch-capacity validation

Status: **COMPLETE** — code-derived analysis + live empirical measurement
(2026-08-31, deployed pilot). Recommended maximum direct/Drive batch: **8 files**.

## Hosting note — URS says "GoDaddy", the pilot runs on Vercel

The URS Phase 5 text refers to *GoDaddy* upload configuration. The pilot is
deployed on **Vercel serverless** (`ella-recruitment-portal-pilot.vercel.app`),
not GoDaddy shared/VPS hosting. All limits and measurements below are for the
Vercel deployment. If a GoDaddy migration is still planned, the request-body
size limit, PHP/proxy timeouts, and process memory on that host must be
re-checked — GoDaddy shared hosting typically caps request bodies far below
100 MB and kills long requests aggressively, which would make the 8-file cap
(≈68 s in-request) unsafe there without the async-drain refactor.

## Empirical results (2026-08-31, Vercel pilot, Google Drive import path)

| Batch | Request → `202` | Poll → all terminal | Client-visible timeout | Orphaned `Processing` | Credits charged | Sheet ↔ Neon |
| --- | --- | --- | --- | --- | --- | --- |
| **2 files** | **34.7 s** | +7 s | none | 0 | 1 (= Screened count) | ✅ in sync |
| **5 files** | **60.4 s** | +6 s | none | 0 | 2 (= Screened count) | ✅ in sync |
| **8 files** | **68.0 s** | +5 s | none | 0 | 1 (= Screened count) | ✅ in sync |

- All three returned HTTP `202`, no gateway/timeout error, **zero orphaned
  `Processing` rows**, credits == count of newly `Screened` files, ledger
  reconciled after every batch (11 → 10 → 8 → 7).
- In-request time is dominated by **full AI screening of the passing files**
  (~20–30 s each), not the 10 s stagger — the 5→8 step only added ~8 s because
  the 3 extra files were cross-batch dedupe skips.
- **Not exercised:** 8 files that *all* pass full screening — projected
  ~110–130 s. Still under Vercel Fluid Compute's 300 s default, but this is the
  number to watch before ever raising the cap.
- Failure isolation confirmed live: a single batch produced 4 `Failed` + 3
  `Skipped` + 1 `Screened` with no batch abort.

## Hard limits in the current code

| Limit | Value | Source |
| --- | --- | --- |
| Files per submission (operator cap) | **8** (local upload + Google Drive import) | `MAX_FILES_PER_SUBMISSION`, upload route `422` + drive/import zod `.max` + UI |
| Files per batch (internal architecture) | **25** — unchanged | `MAX_FILES_PER_BATCH`; OneDrive import still on this (deferred) |
| Per-file size | **10 MB** | `MAX_RESUME_FILE_BYTES`, checked pre-download (imports) and pre-store (upload) |
| Total request body (local upload) | **100 MB** | `MAX_BULK_REQUEST_BYTES`, `content-length` check → 413 |
| Screening concurrency | **2** (hard max, not just default) | `MAX_CONCURRENCY = 2` in `bulk-resume-intake.ts` |
| Worker start stagger | **10 s** between each file start after the first 2 | `WORKER_START_INTERVAL_MS = 10_000` |
| Upload rate limit | 5 requests / 15 min / user | `consumeRateLimit("bulk-resume-upload", 5, …)` |
| Import rate limit | 5 requests / 15 min / user | `consumeRateLimit("drive-import" / "onedrive-import", 5, …)` |
| Vercel function `maxDuration` | **not configured** — deliberately not the sole fix; the 8-file cap is the primary control | no `vercel.json`, no `export const maxDuration` |

## The controlling constraint: synchronous request duration

`POST /bulk/upload` and `POST /*/import` **`await intakeResumeBatch(...)` to
completion before returning `202`.** `intakeResumeBatch` runs the whole staggered
worker pool inline. Wall-clock time for a batch of *N* accepted files is
approximately:

```
t ≈ (N − 2) × 10 s   +   (download + PDF parse + Drive store + webhook for the last file)
```

| N files | Minimum in-request time (stagger only) | + per-file work | Practical total |
| --- | --- | --- | --- |
| 2 | 0 s | ~3–8 s | **~5–10 s** |
| 5 | 30 s | ~5 s | **~35–45 s** |
| 10 | 80 s | ~5 s | **~85–95 s** |
| 15 | 130 s | ~5 s | **~135–150 s** |
| 25 | 230 s | ~5 s | **~235–260 s (≈4 min)** |

### Observed failure point

**Measured:** 8 files completed in-request at **68 s** with no timeout — so the
pilot's effective function budget is **≥ 70 s** (consistent with Vercel Fluid
Compute's 300 s default; no `maxDuration` is set but Fluid Compute does not fall
back to the old 10 s/15 s Node limits).

Derived ceiling for other budgets (if Fluid Compute were disabled or a lower
`maxDuration` set):

| Effective budget | Largest batch that completes in-request |
| --- | --- |
| 60 s | **~5 files** (the 5-file run measured 60.4 s — on the edge) |
| 300 s | **~8 files with headroom; ~12–15 if all screen fully** |

**Recommended safe maximum: 8 files** — the enforced cap. It clears the pilot's
budget with margin in the common case (some fails / dedupe skips) and stays
under 300 s even in the all-pass worst case.

## Memory / resource behaviour (derived)

- **Local upload** is the heavier path: `request.formData()` buffers the entire
  multipart body (up to 100 MB) in memory at once, then holds 25 `File` objects.
  Peak ≈ 100 MB + PDF.js parse working set. Fits the 1 GB (or 2 GB) Vercel
  function, but is the largest single allocation in the app.
- **Drive / OneDrive import** streams one file at a time through `getBytes()`;
  concurrency 2 → ≈ 2 × 10 MB raw + 2 PDF parses in flight. Much flatter memory
  curve; more total time (network fetch per file) but safer.
- `storeResumeFile` writes each file to the Shared Drive and runs PDF text
  extraction synchronously per file — CPU-bound, dominated by PDF.js.
- No streaming, no disk spooling — everything is in-memory buffers.

## Queue & partial-failure behaviour (verified in code)

- Each file gets its own `Bulk_Resume_Queue` `Processing` row **before** the
  webhook call; on any per-file error a `Failed` row is written and the stored
  copy is deleted. One bad file never aborts the batch — the worker loop
  `catch`es per item.
- Credits: `assertCreditsAvailable(N)` is a whole-batch pre-check (→ 402 with
  nothing dispatched); `recordDeduction` then fires **once per file that the
  webhook accepted** (`creditedFiles`), wrapped in `.catch` so a ledger hiccup
  never blocks screening.
- Same-batch duplicates are collapsed before processing; cross-batch duplicates
  are skipped by SHA-256 + role after `storeResumeFile` reports `reused`.

## Direct upload vs Google Drive vs OneDrive

| Dimension | Direct / local upload | Google Drive import | OneDrive import |
| --- | --- | --- | --- |
| Files/batch cap | **8** | **8** | 25 (deferred) |
| Request payload | up to 100 MB (the files) | tiny JSON `{roleId, fileIds}` | tiny JSON |
| Memory peak | **high** — `request.formData()` buffers the whole body | low — 1–2 files at a time | low |
| Added latency | none | Google `files.get` download per file | Graph `downloadUrl` fetch per file |
| Screening pipeline | **shared `intakeResumeBatch`** — identical dedupe / credits / queue / webhook | same | same |
| Measured 8-file time | not separately measured; ≈ Drive minus ~1–2 s download, plus the body upload | **68 s (measured)** | **Deferred / Not validated** |
| Recommended max | **8** | **8** | not published until validated |

The intake pipeline is shared, so the direct-upload path's in-request time is
within a few seconds of the Drive path for the same file count (it trades N
Drive downloads for one multipart body upload). The **8-file cap applies to both**
and the 68 s Drive measurement is the governing number.

## Mitigation applied

**A temporary hard cap of 8 files per submission is now enforced** for the local
upload and the Google Drive import, at both layers:

- `src/lib/bulk-resume-intake.ts` — `MAX_FILES_PER_SUBMISSION = 8` (operator
  cap) alongside the unchanged `MAX_FILES_PER_BATCH = 25` (internal architecture:
  worker pool, dedupe, concurrency all still built for 25, so the cap is a
  one-line raise later).
- Server: `bulk/upload` returns `422 "Upload up to 8 resumes per batch."`;
  `drive/import` zod `.max(MAX_FILES_PER_SUBMISSION)` → `422`.
- UI: the dropzone stops accepting past 8 (surfaces a message, truncates the
  list), the Start button disables above 8, and the Google Drive picker caps
  selection at 8.
- **OneDrive is intentionally left at 25** — it is deferred and not part of this
  release; its route still references `MAX_FILES_PER_BATCH`.
- Covered by `tests/bulk-batch-cap.test.mjs` (7 assertions).

At 8 files the in-request time is ≈ `6 × 10 s + parse ≈ 60–75 s`, which fits a
60 s budget only marginally and a larger budget comfortably. **`maxDuration` is
deliberately NOT set as the sole fix** — the cap is the primary control; a
function budget can be added later as defence-in-depth once measured.

## Remaining recommendations (not blocking freeze)

1. **Proper fix (roadmap):** move the staggered worker pool out of the request —
   return `202` immediately after `assertCreditsAvailable` + queue-row creation,
   run dispatch from a background task / Vercel Cron drain. Removes the timeout
   ceiling entirely and lets the cap go back to 25. This pairs naturally with the
   `reconcileBulkResumeQueue` cron proposed in the R1 investigation.
2. **Do not raise the 10 MB / 100 MB / concurrency-2 limits** to force larger
   batches — concurrency 2 and the 10 s stagger protect the n8n instance and the
   Sheets write budget.
3. Once dispatch is off-request, a live re-measure can justify raising
   `MAX_FILES_PER_SUBMISSION` back toward 25.

## Phase 5 conclusions

1. **Recommended maximum direct-upload batch: 8 files.** Enforced (`MAX_FILES_PER_SUBMISSION`).
2. **Recommended maximum Google Drive batch: 8 files.** Same cap, empirically confirmed at 68 s / `202` / no timeout.
3. **OneDrive: no recommended maximum published** — deferred, not validated. Route still on 25; must be re-measured when Entra config lands.
4. Do **not** raise the 10 MB / 100 MB / concurrency-2 / 10 s-stagger values to force larger batches — they protect the n8n instance and the Sheets write budget.
5. The path to a higher cap is the **"202-then-background-drain"** refactor (tracked post-freeze, `PHASE-2-BACKEND-MIGRATION.md` §2). After that, re-measure and raise `MAX_FILES_PER_SUBMISSION` toward 25.
6. If the deployment ever moves to **GoDaddy**, re-run this validation there first — its request-body and timeout limits are much tighter than Vercel's.

### Optional follow-up measurements (not blocking)

- An 8-file batch where every file passes full screening (~110–130 s projected) — confirms the all-pass worst case stays under budget.
- Peak function memory for a full 8×10 MB **local** upload (the heavy path) via the Vercel metrics dashboard.
