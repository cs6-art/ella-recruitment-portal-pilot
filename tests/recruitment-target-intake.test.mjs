import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("Postgres target resume storage is env-backed and isolated from Settings Sheets", () => {
  const source = read("src/lib/resume-files.ts");
  const targetStart = source.indexOf("if (isPostgresRecruitmentTarget())");
  const legacyStart = source.indexOf("const folderId = (await getPortalConfigValue", targetStart);
  const targetBranch = source.slice(targetStart, legacyStart);
  assert.match(targetBranch, /RESUME_STORAGE_DRIVE_FOLDER_ID/);
  assert.match(targetBranch, /required for Postgres recruitment target intake/);
  assert.doesNotMatch(targetBranch, /getPortalConfigValue\("Resume_Storage_Drive_Folder_ID"\)/);
});

test("target intake creates the queue only after target storage and application inputs are valid", () => {
  const source = read("src/lib/recruitment-target-bulk.ts");
  assert.match(source, /storeResumeFile/);
  assert.match(source, /enqueueBulkScreening/);
  assert.match(source, /createApplication/);
  assert.match(source, /status: "queued"/);
  assert.doesNotMatch(source, /recordDeduction/);
});

test("target manual intake charges fresh screening results in the worker and reused results atomically", () => {
  const portal = read("src/lib/recruitment-target-portal.ts");
  const applicants = read("src/app/api/applicants/route.ts");
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(portal, /copyScreeningResult/);
  assert.match(portal, /screeningReused/);
  assert.match(portal, /Postgres target reused resume screening/);
  assert.match(queries, /export async function copyScreeningResult/);
  assert.match(queries, /appendAccountLedgerEntryOnExecutor\(tx/);
  assert.match(applicants, /await targetCreateApplication/);
  assert.match(applicants, /queued for CV analysis/);
  assert.match(applicants, /creditsCharged: reused \? await creditCostFor\("cv_analysis"\) : 0/);
});

test("target manual intake does not leave an unqueueable application after handoff failure", () => {
  const portal = read("src/lib/recruitment-target-portal.ts");
  const applicants = read("src/app/api/applicants/route.ts");
  assert.match(portal, /if \(result\.created\) await deleteApplication\(result\.application\.externalId\)/);
  assert.match(applicants, /targetRoleDetails\(roleId, user\.organizationId\)/);
});
