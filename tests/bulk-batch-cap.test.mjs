import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// Temporary hosting-safety cap: at most 20 files per direct upload / Google
// Drive import, enforced at the UI and the server. Raised from 6 to 20 once
// the project moved to Vercel Pro (300s function ceiling) and the intake
// path gained 4-way concurrency -- see the cost breakdown on
// MAX_FILES_PER_SUBMISSION in bulk-resume-limits.ts. The 25-file internal
// architecture limit is preserved so the cap can be raised further later
// without a rewrite.

test("the internal 25-file architecture limit is preserved", () => {
  const intake = read("src/lib/bulk-resume-intake.ts");
  assert.match(intake, /export const MAX_FILES_PER_BATCH = 25;/);
  // worker pool / concurrency untouched
  assert.match(intake, /MAX_CONCURRENCY = 2/);
});

test("the operator-facing cap lives in one dependency-free module, is 20 (Pro-fitting), and documented as temporary", () => {
  const limits = read("src/lib/bulk-resume-limits.ts");
  assert.match(limits, /export const MAX_FILES_PER_SUBMISSION = 20;/);
  // comment must explain it is temporary and raisable
  assert.match(limits, /[Tt]emporary/);
  assert.match(limits, /[Rr]aise this back toward MAX_FILES_PER_BATCH/);
  // bulk-resume-intake.ts must re-export, not redeclare, so there is exactly
  // one source of truth
  const intake = read("src/lib/bulk-resume-intake.ts");
  assert.match(intake, /export \{ MAX_FILES_PER_SUBMISSION \} from ".\/bulk-resume-limits"/);
  assert.doesNotMatch(intake, /export const MAX_FILES_PER_SUBMISSION\s*=/);
});

test("the local upload route enforces the 20-file cap server-side", () => {
  const route = read("src/app/api/resume-screening/bulk/upload/route.ts");
  assert.match(route, /MAX_FILES_PER_SUBMISSION/);
  assert.doesNotMatch(route, /MAX_FILES_PER_BATCH\b/);
  assert.match(route, /files\.length > MAX_FILES_PER_SUBMISSION/);
  assert.match(route, /Upload up to \$\{MAX_FILES_PER_SUBMISSION\} resumes per batch\./);
  // rejected with 422, not silently truncated
  assert.match(route, /return responseError\(`Upload up to \$\{MAX_FILES_PER_SUBMISSION\} resumes per batch\.`, 422\)/);
});

test("the Google Drive import route enforces the 20-file cap server-side", () => {
  const route = read("src/app/api/resume-screening/drive/import/route.ts");
  assert.match(route, /fileIds: z\.array\([\s\S]*?\)\.min\(1\)\.max\(MAX_FILES_PER_SUBMISSION\)/);
  assert.match(route, /Select 1 to \$\{MAX_FILES_PER_SUBMISSION\} files/);
  assert.doesNotMatch(route, /MAX_FILES_PER_BATCH\b/);
});

test("OneDrive import enforces the same 20-file cap as Google Drive (URS parity)", () => {
  const route = read("src/app/api/resume-screening/onedrive/import/route.ts");
  assert.match(route, /fileIds: z\.array\([\s\S]*?\)\.min\(1\)\.max\(MAX_FILES_PER_SUBMISSION\)/);
  assert.match(route, /Select 1 to \$\{MAX_FILES_PER_SUBMISSION\} files/);
  assert.doesNotMatch(route, /MAX_FILES_PER_BATCH\b/);
});

test("the bulk panel enforces the cap in the UI, imported from the shared module (no local literal)", () => {
  const panel = read("src/components/BulkResumeScreeningPanel.tsx");
  assert.match(panel, /MAX_CAMPAIGN_FILES, MAX_FILES_PER_SUBMISSION/);
  assert.doesNotMatch(panel, /const MAX_FILES_PER_SUBMISSION\s*=\s*\d/);
  // extra dropped files surface an explanation and the list is truncated at
  // the campaign-sized ceiling; requests are split separately into six-file
  // server-safe chunks when screening starts.
  assert.match(panel, /merged\.length > MAX_CAMPAIGN_FILES/);
  assert.match(panel, /return merged\.slice\(0, MAX_CAMPAIGN_FILES\)/);
  assert.match(panel, /files\.length > MAX_FILES_PER_SUBMISSION \? runBulkQueue\(files\) : uploadResumes\(files\)/);
  assert.match(panel, /function retryFailedFiles\(failedFileList: File\[\]\)/);
  assert.match(panel, /failedFileList\.length > MAX_FILES_PER_SUBMISSION/);
  assert.match(panel, /void runBulkQueue\(failedFileList\)/);
  assert.match(panel, /Up to \{MAX_CAMPAIGN_FILES\} PDF, DOC, or DOCX files at once/);
});

// These routes await intake to completion before responding. The live
// (Postgres-target) path runs a bounded 4-worker concurrent pool but still
// costs real time per file (Drive API calls + DB round trips -- see the cost
// breakdown on MAX_FILES_PER_SUBMISSION in bulk-resume-limits.ts). The
// project moved to Vercel Pro, whose Node function ceiling is 300s; raised
// from the Hobby 60s ceiling accordingly (see batch-timeout-risk).
test("every bulk intake route declares maxDuration at the Vercel Pro ceiling", () => {
  for (const route of ["bulk/upload", "drive/import", "onedrive/import"]) {
    const source = read(`src/app/api/resume-screening/${route}/route.ts`);
    assert.match(source, /export const maxDuration = 300;/, route);
  }
});

test("cloud pickers allow campaign-sized selection and split imports into 20-file requests", () => {
  const panel = read("src/components/BulkResumeScreeningPanel.tsx");
  const picker = read("src/components/DriveFilePicker.tsx");
  // shared picker takes a maxSelection prop
  assert.match(picker, /maxSelection = DEFAULT_MAX_SELECTION/);
  assert.match(picker, /const MAX_SELECTION = maxSelection;/);
  // both cloud pickers allow the campaign-sized selection; each request still
  // stays within the server's per-submission limit via sequential chunking.
  assert.match(panel, /maxSelection=\{MAX_CAMPAIGN_FILES\}/g);
  assert.match(panel, /selectedCloudFiles\(selections\)/);
  assert.match(panel, /index \+= MAX_FILES_PER_SUBMISSION/);
  assert.match(panel, /buildCloudImportRequest\(provider, roleId, chunk\)/);
  assert.match(panel, /Submitting \$\{label\} batch/);
  const oneDriveBlock = panel.slice(panel.indexOf('cloudPicker === "microsoft"'));
  assert.match(oneDriveBlock.slice(0, 400), /maxSelection=\{MAX_CAMPAIGN_FILES\}/);
});
