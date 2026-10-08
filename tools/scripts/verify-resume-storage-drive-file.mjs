// Verifies that resume storage works with the service account holding ONLY
// the non-restricted drive.file scope, exactly as src/lib/resume-files.ts does.
//
//   node --env-file=.env.local tools/scripts/verify-resume-storage-drive-file.mjs
//
// Writes to the configured Shared Drive: finds or creates the app-owned
// "Smile Resume Storage" folder (the same folder production will use), then
// uploads, reads back and deletes one small test file. Nothing else is touched.
import { google } from "googleapis";

const DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const MARKER = { key: "smileStorage", value: "resumes" };

const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const key = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/^"|"$/g, "").replace(/\\n/g, "\n");
const rootId = (process.env.RESUME_STORAGE_DRIVE_FOLDER_ID || "").trim();
if (!email || !key || !rootId) throw new Error("Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY and RESUME_STORAGE_DRIVE_FOLDER_ID.");

const drive = google.drive({ version: "v3", auth: new google.auth.JWT({ email, key, scopes: [DRIVE_FILE] }) });
const step = (label, detail = "") => console.log(`PASS  ${label}${detail ? `  ${detail}` : ""}`);

const findFolders = async () => (await drive.files.list({
  q: `'${rootId}' in parents and mimeType = '${FOLDER_MIME}' and appProperties has { key='${MARKER.key}' and value='${MARKER.value}' } and trashed = false`,
  fields: "files(id, createdTime, capabilities(canAddChildren))",
  orderBy: "createdTime",
  includeItemsFromAllDrives: true,
  supportsAllDrives: true,
})).data.files || [];

let [folder] = await findFolders();
if (!folder) {
  await drive.files.create({
    supportsAllDrives: true,
    requestBody: { name: "Smile Resume Storage", mimeType: FOLDER_MIME, parents: [rootId], appProperties: { [MARKER.key]: MARKER.value } },
    fields: "id",
  });
  [folder] = await findFolders();
  step("created app storage folder with drive.file");
}
if (!folder?.id || folder.capabilities?.canAddChildren === false) throw new Error("FAIL  app storage folder is missing or not writable");
step("app storage folder found and writable", folder.id);

const meta = await drive.files.get({ fileId: folder.id, fields: "id, driveId, mimeType", supportsAllDrives: true });
step("folder metadata readable with drive.file", `driveId=${meta.data.driveId || "(none)"}`);

const created = await drive.files.create({
  supportsAllDrives: true,
  requestBody: { name: `drive-file-scope-check-${Date.now()}.txt`, parents: [folder.id], properties: { kind: "scope-check" } },
  media: { mimeType: "text/plain", body: "drive.file scope check" },
  fields: "id",
});
step("uploaded test file into app folder", created.data.id);

const media = await drive.files.get({ fileId: created.data.id, alt: "media", supportsAllDrives: true }, { responseType: "text" });
if (media.data !== "drive.file scope check") throw new Error("FAIL  test file content did not round-trip");
step("downloaded test file");

const listed = await drive.files.list({ q: `('${folder.id}' in parents or '${rootId}' in parents) and trashed = false`, fields: "files(id)", pageSize: 5, includeItemsFromAllDrives: true, supportsAllDrives: true });
step("listed app files in folder and legacy root", `${(listed.data.files || []).length} shown`);

await drive.files.delete({ fileId: created.data.id, supportsAllDrives: true });
step("deleted test file");
console.log("\nResume storage works with drive.file only. No restricted Drive scope is needed.");
