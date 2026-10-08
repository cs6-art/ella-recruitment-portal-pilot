import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  APPROVED_USER_OAUTH_SCOPES,
  GOOGLE_SCOPE,
  SERVICE_ACCOUNT_SCOPES,
  USER_OAUTH_SCOPES,
  checkGrantedScopes,
  isBroadDriveScope,
} from "../src/lib/google-oauth-scopes.ts";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const AUTH = "https://www.googleapis.com/auth/";
const DRIVE_READONLY = `${AUTH}drive.readonly`;
const DRIVE_METADATA_READONLY = `${AUTH}drive.metadata.readonly`;
const DRIVE_FULL = `${AUTH}drive`;

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|mjs|js)$/.test(name) ? [full] : [];
  });
}

test("the approved user OAuth scopes are exactly what Google Cloud Console declares", () => {
  assert.deepEqual([...APPROVED_USER_OAUTH_SCOPES].sort(), [
    `${AUTH}calendar.events`,
    `${AUTH}calendar.events.freebusy`,
    `${AUTH}drive.file`,
    `${AUTH}userinfo.email`,
  ]);
  for (const scope of APPROVED_USER_OAUTH_SCOPES) assert.equal(isBroadDriveScope(scope), false, scope);
});

test("resume import requests drive.file + userinfo.email and no restricted Drive scope", () => {
  assert.deepEqual([...USER_OAUTH_SCOPES.resumeDrive], [GOOGLE_SCOPE.driveFile, GOOGLE_SCOPE.userinfoEmail]);
  for (const forbidden of [DRIVE_READONLY, DRIVE_METADATA_READONLY, DRIVE_FULL]) {
    assert.equal(USER_OAUTH_SCOPES.resumeDrive.includes(forbidden), false, forbidden);
    assert.equal(USER_OAUTH_SCOPES.recordingDrive.includes(forbidden), false, forbidden);
  }
  assert.ok(USER_OAUTH_SCOPES.recordingDrive.includes(GOOGLE_SCOPE.driveFile));
});

test("calendar scopes are requested only by the calendar flow", () => {
  assert.deepEqual([...USER_OAUTH_SCOPES.calendar].sort(), [GOOGLE_SCOPE.calendarEvents, GOOGLE_SCOPE.calendarEventsFreebusy, GOOGLE_SCOPE.userinfoEmail].sort());
  for (const flow of ["resumeDrive", "recordingDrive"]) {
    assert.equal(USER_OAUTH_SCOPES[flow].some((scope) => scope.includes("calendar")), false, flow);
  }
  assert.equal(USER_OAUTH_SCOPES.calendar.some((scope) => scope.includes("/drive")), false);
});

test("service accounts hold no restricted Drive scope", () => {
  for (const [name, scopes] of Object.entries(SERVICE_ACCOUNT_SCOPES)) {
    for (const scope of scopes) assert.equal(isBroadDriveScope(scope), false, `${name}: ${scope}`);
  }
  assert.deepEqual([...SERVICE_ACCOUNT_SCOPES.resumeStorage], [GOOGLE_SCOPE.driveFile]);
});

test("old drive.readonly connections are rejected and must reconnect", () => {
  // Pre-Picker connections stored exactly this.
  assert.equal(checkGrantedScopes("resumeDrive", `${DRIVE_READONLY} ${AUTH}userinfo.email`).ok, false);
  // A token where an earlier incremental grant folded drive.readonly in next to drive.file.
  const mixed = checkGrantedScopes("resumeDrive", [GOOGLE_SCOPE.driveFile, DRIVE_READONLY, GOOGLE_SCOPE.userinfoEmail]);
  assert.equal(mixed.ok, false);
  assert.deepEqual(mixed.unapproved, [DRIVE_READONLY]);
  assert.equal(checkGrantedScopes("recordingDrive", [GOOGLE_SCOPE.driveFile, DRIVE_METADATA_READONLY, GOOGLE_SCOPE.userinfoEmail]).ok, false);
  assert.equal(checkGrantedScopes("resumeDrive", [GOOGLE_SCOPE.driveFile, DRIVE_FULL, GOOGLE_SCOPE.userinfoEmail]).ok, false);
  // Empty or unknown stored scope cannot prove drive.file.
  assert.equal(checkGrantedScopes("resumeDrive", "").ok, false);
  // The current, correct grant.
  assert.equal(checkGrantedScopes("resumeDrive", `${GOOGLE_SCOPE.driveFile} ${GOOGLE_SCOPE.userinfoEmail}`).ok, true);
  assert.equal(checkGrantedScopes("resumeDrive", ["openid", GOOGLE_SCOPE.userinfoEmail, GOOGLE_SCOPE.driveFile]).ok, true);
});

test("calendar connections without calendar.events.freebusy must reconnect", () => {
  const legacy = checkGrantedScopes("calendar", [GOOGLE_SCOPE.calendarEvents, GOOGLE_SCOPE.userinfoEmail]);
  assert.equal(legacy.ok, false);
  assert.deepEqual(legacy.missing, [GOOGLE_SCOPE.calendarEventsFreebusy]);
  assert.equal(checkGrantedScopes("calendar", [...USER_OAUTH_SCOPES.calendar]).ok, true);
  assert.equal(checkGrantedScopes("calendar", [...USER_OAUTH_SCOPES.calendar, `${AUTH}calendar`]).ok, false);
});

test("no source file outside the scope module names a Drive, Calendar or identity scope", () => {
  const repo = fileURLToPath(new URL("..", import.meta.url));
  const allowed = path.normalize("src/lib/google-oauth-scopes.ts");
  const offenders = [];
  for (const file of sourceFiles(path.join(repo, "src"))) {
    const relative = path.relative(repo, file);
    const text = readFileSync(file, "utf8");
    if (/auth\/drive\.(readonly|metadata)|auth\/drive["'\s]/.test(text)) offenders.push(`${relative}: restricted Drive scope`);
    if (relative !== allowed && /googleapis\.com\/auth\/(drive|calendar|userinfo)/.test(text)) offenders.push(`${relative}: scope literal outside google-oauth-scopes.ts`);
  }
  assert.deepEqual(offenders, []);
});

test("every consent URL and token check uses the central scope lists", () => {
  const drive = read("src/lib/google-drive.ts");
  const recording = read("src/lib/recording-drive-oauth.ts");
  const calendar = read("src/lib/google-calendar.ts");
  assert.match(drive, /DRIVE_SCOPES = USER_OAUTH_SCOPES\.resumeDrive/);
  assert.match(recording, /RECORDING_DRIVE_SCOPES = USER_OAUTH_SCOPES\.recordingDrive/);
  assert.match(calendar, /CALENDAR_SCOPES = USER_OAUTH_SCOPES\.calendar/);
  for (const source of [drive, recording, calendar]) {
    // earlier grants (such as drive.readonly) are never folded into new tokens
    assert.match(source, /include_granted_scopes: false/);
    assert.doesNotMatch(source, /include_granted_scopes: true/);
    // Google's live token info decides, not the stored string alone
    assert.match(source, /checkGrantedScopes\("(resumeDrive|recordingDrive|calendar)", tokenInfo\.scopes\)/);
  }
  // stale resume Drive tokens are deleted, not reused
  assert.match(drive, /discardStaleConnection/);
  assert.match(drive, /reconnectRequired: true/);
  assert.match(read("src/app/api/auth/google-recording-drive/status/route.ts"), /recordingDriveScopesApproved/);
});

test("calendar never reads event contents: freebusy for availability, events only to write", () => {
  const calendar = read("src/lib/google-calendar.ts");
  assert.doesNotMatch(calendar, /events\.list|events\.get\b/);
  assert.match(calendar, /freebusy\.query/);
  assert.match(calendar, /events\.insert/);
  assert.match(calendar, /events\.patch/);
  assert.match(calendar, /events\.delete/);
});

test("the Google Picker uses the drive.file token, project number and API key, and import reads only picked IDs", () => {
  const picker = read("src/components/GoogleDriveResumePicker.tsx");
  const pickerRoute = read("src/app/api/auth/google-drive/picker/route.ts");
  const driveLib = read("src/lib/google-drive.ts");
  const importRoute = read("src/app/api/resume-screening/drive/import/route.ts");
  assert.match(picker, /setOAuthToken\(data\.accessToken\)/);
  assert.match(picker, /setDeveloperKey\(data\.apiKey\)/);
  // setAppId is what lets Google grant drive.file access to the picked files
  assert.match(picker, /setAppId\(data\.projectNumber\)/);
  assert.match(pickerRoute, /getDrivePickerAccessToken\(user\.email\)/);
  // the Picker token comes from the same scope-checked authorization
  assert.match(driveLib, /getDrivePickerAccessToken[\s\S]*authorizeDrive\(email\)/);
  // import fetches only the IDs the user picked; it never lists or searches Drive
  assert.doesNotMatch(importRoute, /files\.list/);
  assert.match(importRoute, /drive\.files\.get\(\{ fileId,/);
});

test("resume storage keeps resumes in an app-owned folder so drive.file is enough", () => {
  const files = read("src/lib/resume-files.ts");
  assert.match(files, /scopes: \[\.\.\.SERVICE_ACCOUNT_SCOPES\.resumeStorage\]/);
  assert.match(files, /ensureStorageFolder\(rootId\)/);
  assert.match(files, /appProperties has \{ key='\$\{STORAGE_FOLDER_MARKER\.key\}'/);
  assert.match(files, /supportsAllDrives: true/);
  // the Shared Drive root is never read directly (drive.file returns 404 for it)
  assert.doesNotMatch(files, /files\.get\(\{\s*fileId: (folderId|rootId)/);
});
