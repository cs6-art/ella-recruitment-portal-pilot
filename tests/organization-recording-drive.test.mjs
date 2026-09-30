import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("recording Drive OAuth is separate from resume import and limited to the chosen app files", () => {
  const oauth = read("src/lib/recording-drive-oauth.ts");
  assert.match(oauth, /google_drive_recordings/);
  assert.match(oauth, /auth\/drive\.file/);
  assert.match(oauth, /auth\/userinfo\.email/);
  assert.doesNotMatch(oauth, /auth\/drive\.readonly|auth\/drive"/);
  assert.match(oauth, /recording-drive-token-encryption/);
  assert.match(oauth, /createRecordingDriveOAuthState\(organizationId: string, actorEmail: string\)/);
  assert.match(oauth, /timingSafeEqual/);
  assert.match(oauth, /readOAuthConnection\(PROVIDER, email, organizationId\)/);
});

test("recording Drive folder configuration is isolated by organization and refuses folders without add permission", () => {
  const storage = read("src/lib/organization-recording-drive.ts");
  const oauth = read("src/lib/recording-drive-oauth.ts");
  const api = read("src/app/api/organization/recording-drive/folder/route.ts");
  assert.match(storage, /eq\(organizationRecordingDrive\.organizationId, organizationId\.trim\(\)\)/);
  assert.match(storage, /onConflictDoUpdate/);
  assert.match(oauth, /data\.mimeType !== "application\/vnd\.google-apps\.folder"/);
  assert.match(oauth, /data\.capabilities\?\.canAddChildren !== true/);
  assert.match(api, /user\.canEditSettings !== true/);
  assert.match(api, /validateRecordingDriveFolder\(user\.organizationId/);
});

test("recording sessions pin their Google account so playback and retention use the correct org credentials", () => {
  const schema = read("src/db/schema-recruitment.ts");
  const migration = read("drizzle/0034_organization_recording_drive.sql");
  const store = read("src/lib/live-interview-store.ts");
  const storage = read("src/lib/interview-recording-storage.ts");
  const route = read("src/app/api/applicants/[applicationId]/live-interview/recording/route.ts");
  assert.match(schema, /recordingStorageAccountEmail: text\("recording_storage_account_email"\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "organization_recording_drive"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "recording_storage_account_email"/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS "oauth_connections_user_email_provider_key"/);
  assert.match(migration, /'google_drive_recordings'/);
  assert.match(migration, /oauth_connections_org_provider_email_uidx/);
  assert.match(store, /recordingStorageAccountEmail: upload\.accountEmail/);
  assert.match(store, /accountEmail: liveInterviewSessions\.recordingStorageAccountEmail/);
  assert.match(route, /fetchInterviewRecording\(ref\.fileId, request\.headers\.get\("range"\), ref\.organizationId, ref\.accountEmail\)/);
  assert.match(storage, /getOrganizationRecordingDrive\(input\.organizationId\)/);
  assert.match(storage, /parents: \[config\.folderId\]/);
});

test("Settings gives organization admins a Drive connection and keeps OAuth tokens out of Smile API responses", () => {
  const settings = read("src/app/settings/page.tsx");
  const component = read("src/components/RecordingDriveConnect.tsx");
  const connect = read("src/app/api/auth/google-recording-drive/connect/route.ts");
  const callback = read("src/app/api/auth/google-recording-drive/callback/route.ts");
  const pickerConfig = read("src/app/api/organization/recording-drive/picker-config/route.ts");
  const pickerOAuth = read("src/lib/recording-drive-oauth.ts");
  assert.match(settings, /<RecordingDriveConnect\s*\/>/);
  assert.match(component, /id="recording-drive-settings-title"/);
  assert.match(component, /requestAccessToken\(\{ login_hint: status\.accountEmail \}\)/);
  assert.match(component, /setSelectFolderEnabled\(true\)/);
  assert.match(component, /setEnableDrives\(true\)/);
  assert.match(component, /Choose recording folder/);
  assert.match(component, /https:\/\/www\.googleapis\.com\/oauth2\/v2\/userinfo/);
  assert.doesNotMatch(component, /picker-token/);
  assert.match(pickerConfig, /user\.canEditSettings !== true/);
  assert.match(pickerConfig, /getRecordingDrivePickerConfig\(\)/);
  const successPayload = pickerConfig.match(/return NextResponse\.json\((\{ success: true, \.\.\.getRecordingDrivePickerConfig\(\) \})/)?.[1] || "";
  assert.notEqual(successPayload, "", "Picker configuration route must have a recognizable success payload.");
  assert.doesNotMatch(successPayload, /accessToken|refreshToken|access_token|refresh_token/);
  assert.match(pickerOAuth, /return \{ clientId, apiKey, projectNumber \}/);
  assert.doesNotMatch(pickerOAuth, /getRecordingDrivePickerAccess/);
  assert.equal(fs.existsSync("src/app/api/organization/recording-drive/picker-token/route.ts"), false);
  assert.match(connect, /user\.canEditSettings !== true/);
  assert.match(callback, /user\.organizationId !== payload\.organizationId/);
  assert.match(callback, /user\.email\.trim\(\)\.toLowerCase\(\) !== payload\.actorEmail/);
});
