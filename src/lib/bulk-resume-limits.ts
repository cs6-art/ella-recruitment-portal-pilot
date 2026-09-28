/**
 * The single source of truth for the operator-facing bulk resume batch cap.
 *
 * Deliberately its own tiny, dependency-free module: bulk-resume-intake.ts
 * (the historical home of this constant) pulls in server-only dependencies
 * (googleapis, mammoth, credits, resume storage), so anything that needs
 * this number but isn't itself server-only -- the client-side
 * BulkResumeScreeningPanel.tsx, the help-bot knowledge base -- must not
 * import that module just to read one number. Import this file instead.
 */

// Temporary operator-facing hard cap on files per submission, enforced at both
// the UI and server validation layers for the local upload and the Google
// Drive import. It exists only because the intake pipeline is awaited to
// completion inside the request, so a larger batch risks a client-visible
// function timeout.
//
// 2026-09-14: RECRUITMENT_BACKEND=postgres has been live on this deployment
// the whole time, so the code path that actually runs is intakeTargetResumeBatch
// below, NOT the staggered worker pool in this file -- the 4-file cap this
// constant briefly held was calculated for the wrong code path (the legacy
// stagger this function runs when Postgres-target is off) and was needlessly
// conservative for what's actually live.
//
// Per-file cost of the real (Postgres-target) path: pdf-parse text extraction
// (~0.2-1s) + 3 Google Drive API calls in storeResumeFile -- verify folder,
// dedupe check, upload (~0.5-2s combined) + 5 Postgres round trips -- find-dup,
// register file, create application, enqueue, update status (~0.5-1s
// combined). Typical ~1.2-3.5s/file; worst case (slow network, larger file,
// cold connections) ~5-7s/file.
//
// 2026-09-23: intakeTargetResumeBatch runs a bounded 4-worker concurrent pool
// (INTAKE_CONCURRENCY, see recruitment-target-bulk.ts) instead of one file at
// a time, so N files cost ceil(N/4) rounds, not N. The 6-file cap above was
// calculated before that change and against the Hobby 60s ceiling; both are
// now stale.
//
// 2026-09-2x: the project moved to Vercel Pro. maxDuration on all three bulk
// intake routes (bulk/upload, drive/import, onedrive/import) is now 300s.
// 20 files: worst case ceil(20/4)*7s = 35s (real margin under 300s even
// before the concurrency saving is counted); typical case ceil(20/4)*3s =
// 15s. Kept below MAX_FILES_PER_BATCH (25, the internal architecture limit --
// do not raise this constant past it) so the operator cap and the
// architecture cap stay distinct. Raise this back toward MAX_FILES_PER_BATCH
// further only after a live empirical measurement of this path (the same
// method docs/BATCH-CAPACITY-VALIDATION.md used for the legacy path).
export const MAX_FILES_PER_SUBMISSION = 20;

// Total files a reviewer may queue up in one sitting via the "let it sit and
// process" flow. The UI auto-splits this into MAX_FILES_PER_SUBMISSION-sized
// requests fired one at a time (never in parallel -- see
// BulkResumeScreeningPanel.tsx's runBulkQueue), so this number does NOT need
// to respect the Hobby 60s-per-request ceiling the way MAX_FILES_PER_SUBMISSION
// does. It exists only as a sane upper bound on one browser-tab session; a
// larger backlog should be split across sessions.
export const MAX_CAMPAIGN_FILES = 150;
