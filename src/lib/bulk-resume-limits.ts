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
// Drive import. It exists only because the intake pipeline currently runs the
// staggered worker pool inline in the request (~(N-2)x10s plus the last file's
// own full-screening wait), so a larger batch risks a client-visible function
// timeout.
//
// 2026-09-14: RECRUITMENT_BACKEND=postgres has been live on this deployment
// the whole time, so the code path that actually runs is intakeTargetResumeBatch
// below, NOT the staggered worker pool in this file -- the 4-file cap this
// constant briefly held was calculated for the wrong code path (the legacy
// stagger this function runs when Postgres-target is off) and was needlessly
// conservative for what's actually live.
//
// Per-file cost of the real (Postgres-target) path, sequential, no
// concurrency: pdf-parse text extraction (~0.2-1s) + 3 sequential Google
// Drive API calls in storeResumeFile -- verify folder, dedupe check, upload
// (~0.5-2s combined) + 5 sequential Postgres round trips -- find-dup,
// register file, create application, enqueue, update status (~0.5-1s
// combined). Typical ~1.2-3.5s/file; worst case (slow network, larger file,
// cold connections) ~5-7s/file.
//
// 6 files: worst case 6*7s = 42s (30% margin under Hobby's 60s hard ceiling);
// typical case 6*3s = 18s. 8 files at worst case (~56s) was too close to the
// edge to call safe, so 6 is the conservative number -- a real increase from
// 4 (justified by the correct code path), not an unfounded leap.
// Raise this back toward MAX_FILES_PER_BATCH only after a live empirical
// measurement of this path (the same method docs/BATCH-CAPACITY-VALIDATION.md
// used for the legacy path), or once off Hobby (Pro's 300s ceiling removes it).
export const MAX_FILES_PER_SUBMISSION = 6;
