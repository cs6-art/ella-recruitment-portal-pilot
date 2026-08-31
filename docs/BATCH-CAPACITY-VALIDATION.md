# Phase 5 — Hosting & batch-capacity validation

Status: **code-derived analysis complete; live empirical measurement blocked**
(needs a deployed environment + real batches + Vercel runtime metrics, which
require operator access).

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

### Observed failure point (derived)

The batch fails (function times out, client sees a network error, but files
already handed to n8n keep processing) when the total above exceeds the Vercel
function timeout:

| Effective `maxDuration` | Largest batch that completes in-request |
| --- | --- |
| 10 s (Hobby default, no config) | **2 files** |
| 15 s (Pro default, no config) | **2 files** |
| 60 s | **5–6 files** |
| 300 s (Pro/Fluid max) | **25 files, but with no headroom** |

This is the single most important finding: **with no `maxDuration` set, any
batch larger than ~2 files is at risk of a client-visible timeout**, even though
the resumes that were already dispatched continue to be screened by n8n.

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

## Direct upload vs Google Drive import

| Dimension | Direct / local upload | Google Drive import | OneDrive import |
| --- | --- | --- | --- |
| Files/batch cap | 25 | 25 | 25 |
| Request payload | up to 100 MB (the files) | tiny JSON (`{roleId, fileIds}`) | tiny JSON |
| Memory peak | **high** (full body buffered) | low (1–2 files at a time) | low |
| Added latency | none | Google `files.get` download per file | Graph `downloadUrl` fetch per file |
| Time to `202` | stagger + parse | stagger + parse + N downloads | stagger + parse + N downloads |
| Failure threshold | platform timeout (see table) | platform timeout + download time (slightly worse) | **Deferred / Not validated** |

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

## What still needs a live run (operator)

Record, per batch size (try 2, 5, 8, 12, 20, 25):

- upload duration (client) and time-to-`202`
- n8n processing duration to all-terminal
- whether the function timed out (Vercel dashboard → function logs)
- peak memory (Vercel dashboard → function metrics)
- queue rows created vs files sent; any orphaned `Processing` rows
- behaviour when 1 file in the batch is corrupt (expect: it alone → `Failed`)
- behaviour re-submitting an identical batch (expect: all `Skipped`)
