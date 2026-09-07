import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("OneDrive is a wholly separate OAuth connection from any Google credential", () => {
  const lib = read("src/lib/microsoft-drive.ts");
  const tokens = read("src/lib/microsoft-drive-tokens.ts");
  // least-privilege delegated read scope
  assert.match(lib, /MS_DRIVE_SCOPES = \["Files\.Read", "User\.Read", "offline_access"/);
  assert.doesNotMatch(lib, /Files\.ReadWrite|Sites\.|Files\.Read\.All/);
  // Microsoft identity platform, not Google
  assert.match(lib, /login\.microsoftonline\.com/);
  assert.match(lib, /graph\.microsoft\.com/);
  // its own encrypted token store, separate tab + key label
  assert.match(tokens, /TAB = "Microsoft_Drive_Connections"/);
  assert.match(tokens, /"microsoft-drive-token-encryption"/);
  assert.match(tokens, /aes-256-gcm/);
  // reuses the shared generic signed OAuth state
  assert.match(lib, /from "@\/lib\/google-calendar"/);
});

test("OneDrive auth routes are HR-gated and connect the logged-in user's own account", () => {
  for (const action of ["connect", "callback", "status", "disconnect"]) {
    const route = read(`src/app/api/auth/microsoft-drive/${action}/route.ts`);
    if (action !== "callback") assert.match(route, /canManagePipeline/, `${action} should be HR-gated`);
  }
  const connect = read("src/app/api/auth/microsoft-drive/connect/route.ts");
  assert.match(connect, /getMicrosoftConsentUrl\(user\.email/);
  const status = read("src/app/api/auth/microsoft-drive/status/route.ts");
  assert.match(status, /isMicrosoftDriveConfigured/);
});

test("OneDrive list + import feed the shared intake pipeline, not a new one", () => {
  const list = read("src/app/api/resume-screening/onedrive/list/route.ts");
  const importRoute = read("src/app/api/resume-screening/onedrive/import/route.ts");
  assert.match(list, /getAuthorizedGraphToken\(user\.email\)/);
  assert.match(list, /ONEDRIVE_NOT_CONNECTED/);
  assert.match(importRoute, /intakeResumeBatch/);
  assert.match(importRoute, /sourceLabel: "Portal OneDrive Import"/);
  // OneDrive import obeys the same 8-file-per-submission cap as Google Drive
  // import and local upload (URS parity).
  assert.match(importRoute, /\.max\(MAX_FILES_PER_SUBMISSION\)/);
  assert.match(importRoute, /MAX_RESUME_FILE_BYTES/);
  // 402 on insufficient credits, same as local upload
  assert.match(importRoute, /error instanceof EllaCreditsError/);
});

test("OneDrive import handles expired/revoked tokens, missing files and permission errors", () => {
  const lib = read("src/lib/microsoft-drive.ts");
  const importRoute = read("src/app/api/resume-screening/onedrive/import/route.ts");
  // refresh path returns null when the grant is dead -> caller asks to reconnect
  assert.match(lib, /invalid_grant/);
  assert.match(importRoute, /ONEDRIVE_NOT_CONNECTED/);
  assert.match(importRoute, /revoked/i);
  assert.match(importRoute, /no longer available/);
  // partial batch failure: unreadable files become inline Failed results, batch still runs
  assert.match(importRoute, /rejected\.push/);
  assert.match(importRoute, /\[\.\.\.intake\.results, \.\.\.rejected\]/);
});

test("the panel offers Connect / Choose from OneDrive and reuses the shared batch view", () => {
  const panel = read("src/components/BulkResumeScreeningPanel.tsx");
  const request = read("src/lib/cloud-import-request.ts");
  assert.match(panel, /\/api\/auth\/microsoft-drive\/status/);
  assert.match(panel, /Connect OneDrive/);
  assert.match(panel, /Choose from OneDrive/);
  assert.match(panel, /buildCloudImportRequest\(provider, roleId, selections\)/);
  assert.match(request, /\/api\/resume-screening\/onedrive\/import/);
  assert.match(panel, /applyBatchResult/);
  // one shared picker component, parameterised per provider
  assert.match(panel, /listUrl="\/api\/resume-screening\/onedrive\/list"/);
});
