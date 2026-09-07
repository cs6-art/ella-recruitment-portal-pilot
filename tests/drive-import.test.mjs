import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("Google Drive is a separate OAuth connection from the calendar one", () => {
  const drive = read("src/lib/google-drive.ts");
  const tokens = read("src/lib/drive-tokens.ts");
  // minimum read scope only
  assert.match(drive, /"https:\/\/www\.googleapis\.com\/auth\/drive\.readonly"/);
  assert.doesNotMatch(drive, /drive\.file|auth\/drive"|calendar\.events/);
  // its own token store + encryption label, separate from Calendar_Connections
  assert.match(tokens, /TAB = "Drive_Connections"/);
  assert.match(tokens, /"drive-token-encryption"/);
  assert.match(tokens, /aes-256-gcm/);
  // reuses the shared, generic OAuth state helper
  assert.match(drive, /from "@\/lib\/google-calendar"/);
});

test("Drive auth routes are HR-gated and per-user", () => {
  for (const action of ["connect", "callback", "status", "disconnect"]) {
    const route = read(`src/app/api/auth/google-drive/${action}/route.ts`);
    if (action !== "callback") assert.match(route, /canManagePipeline/, `${action} should be HR-gated`);
  }
  const connect = read("src/app/api/auth/google-drive/connect/route.ts");
  // connects the logged-in HR user's own Drive, not a shared config account
  assert.match(connect, /getDriveConsentUrl\(user\.email/);
});

test("Drive list + import feed the shared intake pipeline", () => {
  const list = read("src/app/api/resume-screening/drive/list/route.ts");
  const importRoute = read("src/app/api/resume-screening/drive/import/route.ts");
  assert.match(list, /getAuthorizedDriveClient\(user\.email\)/);
  assert.match(list, /DRIVE_NOT_CONNECTED/);
  assert.match(importRoute, /intakeResumeBatch/);
  assert.match(importRoute, /sourceLabel: "Portal Drive Import"/);
  assert.match(importRoute, /\.max\(MAX_FILES_PER_SUBMISSION\)/);
  // oversized / non-resume / google-native files rejected before download
  assert.match(importRoute, /export as PDF first/);
  assert.match(importRoute, /MAX_RESUME_FILE_BYTES/);
  // 402 on insufficient credits, same as local upload
  assert.match(importRoute, /error instanceof EllaCreditsError/);
});

test("both intake sources use one shared helper with unchanged behaviour", () => {
  const helper = read("src/lib/bulk-resume-intake.ts");
  const upload = read("src/app/api/resume-screening/bulk/upload/route.ts");
  const importRoute = read("src/app/api/resume-screening/drive/import/route.ts");
  assert.match(upload, /intakeResumeBatch/);
  assert.match(importRoute, /intakeResumeBatch/);
  // the helper owns dedupe, queue events, the webhook, credit deduction
  assert.match(helper, /claimedInBatch/);
  assert.match(helper, /appendBulkResumeQueueEvent/);
  assert.match(helper, /eventType: "bulk_resume_uploaded"/);
  assert.match(helper, /recordDeduction/);
  assert.match(helper, /assertCreditsAvailable\(toProcess\.length, "cv_analysis"\)/);
  // the upload route keeps its exact contract
  assert.match(upload, /sourceLabel: "Portal Bulk Upload"/);
  assert.match(upload, /status: 202/);
});

test("the panel offers connect / choose-from-Drive and imports into the same batch view", () => {
  const panel = read("src/components/BulkResumeScreeningPanel.tsx");
  const request = read("src/lib/cloud-import-request.ts");
  assert.match(panel, /\/api\/auth\/google-drive\/status/);
  assert.match(panel, /Connect Google Drive/);
  assert.match(panel, /Choose from Google Drive/);
  assert.match(panel, /buildCloudImportRequest\(provider, roleId, selections\)/);
  assert.match(request, /\/api\/resume-screening\/drive\/import/);
  assert.match(panel, /applyBatchResult/);
  assert.match(panel, /DriveFilePicker/);
});

test("Drive picker selection builds the authenticated import request with the active role", () => {
  const picker = read("src/components/DriveFilePicker.tsx");
  const panel = read("src/components/BulkResumeScreeningPanel.tsx");
  const request = read("src/lib/cloud-import-request.ts");
  // The picker passes the rendered file records, not a free-standing ID set.
  // This preserves the exact file-name-to-file-ID mapping selected by HR.
  assert.match(picker, /const selectedFiles = files\.filter\(\(file\) => selected\.has\(file\.id\)\)/);
  assert.match(picker, /onImport\(selectedFiles\)/);
  assert.match(panel, /buildCloudImportRequest\(provider, roleId, selections\)/);
  assert.match(panel, /fetch\(request\.endpoint, request\.init\)/);
  assert.match(request, /\/api\/resume-screening\/drive\/import/);
  assert.match(request, /selectedCloudFileIds\(selections\)/);
  assert.match(request, /JSON\.stringify\(\{ roleId: normalizedRoleId, fileIds: normalizedFileIds \}\)/);
});

test("Drive selection rejects folders, roots, unsupported files, and stale picker IDs", () => {
  const picker = read("src/components/DriveFilePicker.tsx");
  const request = read("src/lib/cloud-import-request.ts");
  const importRoute = read("src/app/api/resume-screening/drive/import/route.ts");
  assert.match(picker, /file\.id !== "root"/);
  assert.match(picker, /file\.isFolder !== true/);
  assert.match(picker, /file\.mimeType !== "application\/vnd\.google-apps\.folder"/);
  assert.match(picker, /selectedFiles\.length !== selected\.size/);
  assert.match(request, /id === "root"/);
  assert.match(request, /selection\.isFolder === true/);
  assert.match(request, /mimeType === FOLDER_MIME/);
  assert.match(request, /!RESUME_EXT\.test\(name\)/);
  // The server verifies the returned Drive metadata ID before downloading.
  assert.match(importRoute, /resolvedId !== fileId/);
  assert.match(importRoute, /Select a resume file, not a Drive folder/);
});

test("Drive intake keeps queue and credit safety guarantees", () => {
  const importRoute = read("src/app/api/resume-screening/drive/import/route.ts");
  const targetIntake = read("src/lib/recruitment-target-bulk.ts");
  const legacyIntake = read("src/lib/bulk-resume-intake.ts");
  assert.match(importRoute, /submitted: 0/);
  assert.match(importRoute, /creditsCharged: 0/);
  assert.match(importRoute, /intakeResumeBatch/);
  assert.match(targetIntake, /enqueueBulkScreening/);
  assert.match(legacyIntake, /recordDeduction/);
  assert.match(legacyIntake, /idempotencyKey: `cv:\$\{resolvedQueueId\}`/);
});
