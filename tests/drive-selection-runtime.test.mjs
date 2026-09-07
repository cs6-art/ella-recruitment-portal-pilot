import assert from "node:assert/strict";
import test from "node:test";
import { buildCloudImportRequest } from "../src/lib/cloud-import-request.ts";

test("Scenario C keeps the PDF ID when two Shared Drive containers are present", () => {
  const driveA = "0AFViF0P5HxmHUk9PVA";
  const driveB = "0ABRWtyTVVGLcUk9PVA";
  const fileId = "1mQuylEqnLigpHR-h7wVH2fdzzUh7E5fX";
  const request = buildCloudImportRequest("google", "PILOT-DUMMY-C", [
    { id: driveA, name: "Shared Drive", mimeType: "application/vnd.google-apps.folder" },
    { id: driveB, name: "Resumes.pdf", isFolder: true },
    { id: fileId, name: "cyra-bulk-resume.pdf", mimeType: "application/pdf", driveId: driveA, parentId: driveB },
  ]);
  assert.equal(request.endpoint, "/api/resume-screening/drive/import");
  assert.equal(request.init.method, "POST");
  const body = JSON.parse(request.init.body);
  assert.deepEqual(body.fileIds, [fileId]);
  assert.equal(body.files[0].id, fileId);
  assert.equal(body.roleId, "PILOT-DUMMY-C");
});

test("container-only and empty selections cannot create an import request", () => {
  for (const selections of [[], [{ id: "root", name: "resume.pdf" }], [{ id: "container", name: "resume.pdf", isFolder: true }]]) {
    assert.equal(buildCloudImportRequest("google", "PILOT-DUMMY-C", selections), null);
  }
});

test("a file-shaped row is rejected when its ID is a Shared Drive or parent ID", () => {
  const driveId = "0ABRWtyTVVGLcUk9PVA";
  const parentId = "0AFViF0P5HxmHUk9PVA";
  assert.equal(buildCloudImportRequest("google", "PILOT-DUMMY-C", [{ id: driveId, name: "resume.pdf", driveId }]), null);
  assert.equal(buildCloudImportRequest("google", "PILOT-DUMMY-C", [{ id: parentId, name: "resume.pdf", parentIds: [parentId] }]), null);
});
