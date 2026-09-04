import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// Temporary hosting-safety cap: at most 8 files per direct upload / Google
// Drive import, enforced at the UI and the server. The 25-file internal
// architecture is preserved so the cap can be raised later without a rewrite.

test("the internal 25-file architecture limit is preserved", () => {
  const intake = read("src/lib/bulk-resume-intake.ts");
  assert.match(intake, /export const MAX_FILES_PER_BATCH = 25;/);
  // worker pool / concurrency untouched
  assert.match(intake, /MAX_CONCURRENCY = 2/);
});

test("the operator-facing cap is 8 and documented as temporary", () => {
  const intake = read("src/lib/bulk-resume-intake.ts");
  assert.match(intake, /export const MAX_FILES_PER_SUBMISSION = 8;/);
  // comment must explain it is temporary and raisable
  assert.match(intake, /[Tt]emporary/);
  assert.match(intake, /[Rr]aise this back toward MAX_FILES_PER_BATCH/);
});

test("the local upload route enforces the 8-file cap server-side", () => {
  const route = read("src/app/api/resume-screening/bulk/upload/route.ts");
  assert.match(route, /MAX_FILES_PER_SUBMISSION/);
  assert.doesNotMatch(route, /MAX_FILES_PER_BATCH\b/);
  assert.match(route, /files\.length > MAX_FILES_PER_SUBMISSION/);
  assert.match(route, /Upload up to \$\{MAX_FILES_PER_SUBMISSION\} resumes per batch\./);
  // rejected with 422, not silently truncated
  assert.match(route, /return responseError\(`Upload up to \$\{MAX_FILES_PER_SUBMISSION\} resumes per batch\.`, 422\)/);
});

test("the Google Drive import route enforces the 8-file cap server-side", () => {
  const route = read("src/app/api/resume-screening/drive/import/route.ts");
  assert.match(route, /fileIds: z\.array\([\s\S]*?\)\.min\(1\)\.max\(MAX_FILES_PER_SUBMISSION\)/);
  assert.match(route, /Select 1 to \$\{MAX_FILES_PER_SUBMISSION\} files/);
  assert.doesNotMatch(route, /MAX_FILES_PER_BATCH\b/);
});

test("OneDrive import enforces the same 8-file cap as Google Drive (URS parity)", () => {
  const route = read("src/app/api/resume-screening/onedrive/import/route.ts");
  assert.match(route, /fileIds: z\.array\([\s\S]*?\)\.min\(1\)\.max\(MAX_FILES_PER_SUBMISSION\)/);
  assert.match(route, /Select 1 to \$\{MAX_FILES_PER_SUBMISSION\} files/);
  assert.doesNotMatch(route, /MAX_FILES_PER_BATCH\b/);
});

test("the bulk panel enforces the 8-file cap in the UI", () => {
  const panel = read("src/components/BulkResumeScreeningPanel.tsx");
  assert.match(panel, /const MAX_FILES_PER_SUBMISSION = 8;/);
  // extra dropped files surface an explanation and the list is truncated
  assert.match(panel, /merged\.length > MAX_FILES_PER_SUBMISSION/);
  assert.match(panel, /return merged\.slice\(0, MAX_FILES_PER_SUBMISSION\)/);
  // start button disabled if somehow over the cap
  assert.match(panel, /files\.length > MAX_FILES_PER_SUBMISSION \|\| uploading/);
  // dropzone copy reflects the cap, not 25
  assert.match(panel, /Up to \{MAX_FILES_PER_SUBMISSION\} PDF, DOC, or DOCX files per batch/);
  assert.doesNotMatch(panel, /Up to 25 PDF/);
});

test("the Google Drive picker caps selection at 8 via the shared component", () => {
  const panel = read("src/components/BulkResumeScreeningPanel.tsx");
  const picker = read("src/components/DriveFilePicker.tsx");
  // shared picker takes a maxSelection prop
  assert.match(picker, /maxSelection = DEFAULT_MAX_SELECTION/);
  assert.match(picker, /const MAX_SELECTION = maxSelection;/);
  // both the Google Drive and OneDrive instances pass the 8-file cap
  assert.match(panel, /cloudPicker === "google"[\s\S]*?maxSelection=\{MAX_FILES_PER_SUBMISSION\}/);
  const oneDriveBlock = panel.slice(panel.indexOf('cloudPicker === "microsoft"'));
  assert.match(oneDriveBlock.slice(0, 400), /maxSelection=\{MAX_FILES_PER_SUBMISSION\}/);
});
