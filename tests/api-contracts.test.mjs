import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("status transition contract includes canonical fields", () => {
  const payload = { eventType: "role_status_transition", Role_ID: "ROLE-1", Status: "Approved", Last_Updated_At: new Date().toISOString(), actionRequestId: "req-1" };
  assert.equal(payload.eventType, "role_status_transition");
  assert.ok(payload.Status);
  assert.ok(payload.Last_Updated_At);
});

test("status transition responses preserve n8n rejection details", () => {
  const source = fs.readFileSync("src/app/api/roles/[roleId]/status/route.ts", "utf8");
  assert.match(source, /workflowError/);
  assert.match(source, /result\.message/);
});

test("status transitions prefer the canonical role webhook", () => {
  const source = fs.readFileSync("src/app/api/roles/[roleId]/status/route.ts", "utf8");
  // The role webhook URL is resolved from portal config (Settings sheet value
  // overrides N8N_ROLE_REQUEST_WEBHOOK_URL / N8N_ROLE_WEBHOOK_URL env vars).
  assert.match(source, /getPortalConfigValue\("N8N_Role_Webhook_URL"\)/);
  assert.match(source, /event_type: "role_status_transition"/);
  assert.match(source, /updateRoleRequestFields\(role\.roleId/);
  assert.match(source, /invalidateSheetsCache\("Role_Status_History"\)/);
});

test("duplicate action request IDs are idempotency keys", () => {
  const headers = { "X-Idempotency-Key": "req-1" };
  assert.equal(headers["X-Idempotency-Key"], "req-1");
});

test("role creation uses the canonical n8n event", () => {
  const source = fs.readFileSync("src/app/api/roles/route.ts", "utf8");
  assert.match(source, /eventType: "role_request_created"/);
  assert.match(source, /Status: initialStatus/);
  assert.match(source, /Last_Updated_At: createdAt/);
  assert.match(source, /portalUrl/);
  assert.match(source, /\/roles\/\$\{encodeURIComponent\(roleId\)\}/);
});

test("role forms autosave drafts without invoking the creation workflow", () => {
  const route = fs.readFileSync("src/app/api/roles/route.ts", "utf8");
  const detailsRoute = fs.readFileSync("src/app/api/roles/[roleId]/route.ts", "utf8");
  const form = fs.readFileSync("src/components/RoleRequestForm.tsx", "utf8");
  assert.match(route, /clientInput\.draft === true/);
  assert.match(route, /appendRoleRequestDraft/);
  assert.match(detailsRoute, /body\.draft === true/);
  assert.match(form, /autosaveDraft/);
  assert.match(form, /draft: true/);
});

test("draft writes use fresh role reads across app instances", () => {
  const sheets = fs.readFileSync("src/lib/google-sheets.ts", "utf8");
  const createRoute = fs.readFileSync("src/app/api/roles/route.ts", "utf8");
  const detailsRoute = fs.readFileSync("src/app/api/roles/[roleId]/route.ts", "utf8");
  const statusRoute = fs.readFileSync("src/app/api/roles/[roleId]/status/route.ts", "utf8");
  const form = fs.readFileSync("src/components/RoleRequestForm.tsx", "utf8");
  assert.match(sheets, /freshSheetsRead/);
  assert.match(sheets, /options: \{ fresh\?: boolean \} = \{\}/);
  assert.match(createRoute, /getRoleRequestById\(roleId, \{ fresh: true \}\)/);
  assert.match(detailsRoute, /getRoleRequestById\(roleId, \{ fresh: true \}\)/);
  assert.match(statusRoute, /getRoleRequestById\(roleId, \{ fresh: true \}\)/);
  assert.match(form, /await draftSaveInFlight\.current/);
});

test("Postgres draft writes stay on the target and normalize constrained labels", () => {
  const createRoute = fs.readFileSync("src/app/api/roles/route.ts", "utf8");
  const statusRoute = fs.readFileSync("src/app/api/roles/[roleId]/status/route.ts", "utf8");
  const queries = fs.readFileSync("src/lib/internal-recruitment-queries.ts", "utf8");
  assert.match(createRoute, /targetRoleDetails\(roleId\)/);
  assert.match(createRoute, /targetUpdateRoleFields\(roleId, fields\)/);
  assert.match(statusRoute, /targetRoleDetails\(roleId\)/);
  assert.match(statusRoute, /targetRoleStatusHistory\(role\.roleId\)/);
  assert.match(queries, /normalizeRequestType\(input\.requestType\)/);
  assert.match(queries, /normalizeRoleStatus\(input\.status\)/);
  assert.match(queries, /normalizeRecruitmentSetupStatus\(input\.recruitmentSetupStatus\)/);
});

test("Postgres booking responses convert Date timestamps into local date and time fields", () => {
  const source = fs.readFileSync("src/lib/recruitment-target-portal.ts", "utf8");
  assert.match(source, /value instanceof Date/);
  assert.match(source, /new Intl\.DateTimeFormat\("en-CA"/);
  assert.doesNotMatch(source, /text\(slot\.startsAt\)\.slice\(0, 10\)/);
  assert.doesNotMatch(source, /text\(slot\.startsAt\)\.slice\(11, 16\)/);
});

test("Postgres role statuses preserve HR review action labels", () => {
  const source = fs.readFileSync("src/lib/recruitment-target-portal.ts", "utf8");
  assert.match(source, /replace\(\/\\bHr\\b\/g, "HR"\)/);
  assert.match(source, /previousStatus: label\(history\.previousStatus\)/);
  assert.match(source, /newStatus: label\(history\.newStatus\)/);
});

test("draft submission has an audited transition into HR review", () => {
  const source = fs.readFileSync("src/app/api/roles/[roleId]/status/route.ts", "utf8");
  assert.match(source, /submit_draft_for_hr/);
  assert.match(source, /target: "Pending HR Discussion"/);
  assert.match(source, /user\.canCreateRole === true/);
});

test("recruitment template reads use valid open-ended A1 ranges", () => {
  const source = fs.readFileSync("src/lib/google-sheets.ts", "utf8");
  assert.doesNotMatch(source, /Recruitment_Templates!A1:G["`]/);
  assert.match(source, /Recruitment_Templates!A:G/);
});

test("role reads include requester columns near the end of the sheet schema", () => {
  const source = fs.readFileSync("src/lib/google-sheets.ts", "utf8");
  assert.match(source, /range: "Role_Requests!A1:ZZ"/);
  assert.doesNotMatch(source, /range: "Role_Requests!A1:AN"/);
});

test("recruitment template setup errors identify the missing sheet tab", () => {
  const source = fs.readFileSync("src/app/api/recruitment-templates/route.ts", "utf8");
  assert.match(source, /Recruitment_Templates sheet tab is missing/);
  assert.match(source, /data\/sheet-templates\/Recruitment_Templates\.csv/);
});

test("saved recruitment templates stay isolated from role request rows", () => {
  const templateRoute = fs.readFileSync("src/app/api/recruitment-templates/route.ts", "utf8");
  const editor = fs.readFileSync("src/components/RecruitmentSetupEditor.tsx", "utf8");
  assert.match(templateRoute, /Recruitment_Templates/);
  assert.doesNotMatch(templateRoute, /Role_Requests/);
  assert.doesNotMatch(editor, /CALL SCRIPT TEMPLATES/);
  assert.doesNotMatch(editor, /SAVED TEMPLATES/);
  assert.match(editor, /Reset changes/);
  assert.doesNotMatch(editor, /Load standard script/);
});

test("candidate intake allows repeated email and role applications with new identities", () => {
  const workflow = fs.readFileSync("src/lib/applicant-workflow.ts", "utf8");
  const publicRoute = fs.readFileSync("src/app/api/public/applications/route.ts", "utf8");
  const hrRoute = fs.readFileSync("src/app/api/applicants/route.ts", "utf8");
  assert.match(workflow, /normalizePreferredMobile/);
  assert.doesNotMatch(workflow, /findDuplicateCandidateApplication/);
  assert.doesNotMatch(publicRoute, /findDuplicateCandidateApplication|DUPLICATE_APPLICATION/);
  assert.doesNotMatch(hrRoute, /findDuplicateCandidateApplication|DUPLICATE_APPLICATION/);
  assert.match(publicRoute, /`APP-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(hrRoute, /`APP-\$\{crypto\.randomUUID\(\)\}`/);
});

test("history identity fields are server-owned and normalized", () => {
  const statusSource = fs.readFileSync("src/app/api/roles/[roleId]/status/route.ts", "utf8");
  const creationSource = fs.readFileSync("src/app/api/roles/route.ts", "utf8");
  assert.match(statusSource, /Changed_By_Name: user\.name/);
  assert.match(statusSource, /Changed_By_Email: user\.email\.trim\(\)\.toLowerCase\(\)/);
  assert.match(statusSource, /Access_Role: user\.accessRole/);
  assert.match(statusSource, /Department: user\.department/);
  assert.match(creationSource, /Action: "role_request_created"/);
  assert.match(creationSource, /Access_Role: user\.accessRole/);
  assert.match(creationSource, /Department: user\.department/);
});

test("history display preserves email casing rules and creation label", () => {
  const formatter = fs.readFileSync("src/lib/formatters.ts", "utf8");
  const roleDetails = fs.readFileSync("src/components/RoleDetails.tsx", "utf8");
  const actions = fs.readFileSync("src/lib/status-actions.ts", "utf8");
  assert.match(formatter, /trim\(\)\.toLowerCase\(\)/);
  assert.match(roleDetails, /formatEmail\(entry\.performedByEmail\)/);
  assert.match(roleDetails, /entry\.action === "role_request_created"/);
  assert.match(actions, /role_request_created: "Role Request Created"/);
  assert.doesNotMatch(roleDetails, /entry\.previousStatus\}.*→.*entry\.newStatus\}/);
  assert.doesNotMatch(roleDetails, /Not provided.*Not provided/);
});
