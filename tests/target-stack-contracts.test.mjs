import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const routeFiles = [
  "roles/route.ts", "roles/status/route.ts", "applicants/route.ts", "applications/route.ts", "applications/detail/route.ts",
  "screening/route.ts", "screening/invitations/route.ts", "hr-decisions/route.ts", "hr-decisions/queue/route.ts",
  "voice/queue/route.ts", "voice/queue/claim/route.ts", "voice/attempts/status/route.ts", "voice/results/route.ts", "voice/logs/route.ts",
  "bookings/route.ts", "bookings/slots/route.ts", "bookings/tokens/route.ts", "bookings/calendar/route.ts", "bulk/queue/route.ts", "bulk/queue/claim/route.ts", "bulk/queue/status/route.ts",
  "status-history/route.ts", "notifications/route.ts", "bulk/process/route.ts",
];

test("target API has a route for every operational recruitment domain", () => {
  for (const route of routeFiles) assert.ok(existsSync(new URL(`../src/app/api/internal/recruitment/${route}`, import.meta.url)), route);
});

test("every target route is authenticated and has no direct Sheets dependency", () => {
  for (const route of routeFiles) {
    const source = read(`src/app/api/internal/recruitment/${route}`);
    assert.match(source, /withInternalAuth\(/, route);
    assert.doesNotMatch(source, /google-sheets|googleapis|spreadsheets\.values|Sheets/, route);
  }
});

test("portal target adapter is server-only and routes through authenticated internal APIs", () => {
  const source = read("src/lib/recruitment-target-api.ts");
  assert.match(source, /INTERNAL_API_SECRET/);
  assert.match(source, /Authorization: `Bearer \$\{secret\}`/);
  assert.match(source, /cache: "no-store"/);
  assert.doesNotMatch(source, /NEXT_PUBLIC/);
  assert.doesNotMatch(source, /DATABASE_URL|google-sheets|spreadsheets\.values/);
});

test("portal Postgres routing is explicit and dormant by default", () => {
  const mode = read("src/lib/recruitment-target-mode.ts");
  const envExample = read(".env.example");
  assert.match(mode, /RECRUITMENT_BACKEND\?\.trim\(\)\.toLowerCase\(\) === "postgres"/);
  assert.match(envExample, /RECRUITMENT_BACKEND=postgres/);
  assert.match(envExample, /dormant by default/i);
});

test("portal operational helpers have a Postgres target branch", () => {
  const sheets = read("src/lib/google-sheets.ts");
  const candidates = read("src/lib/candidate-applications.ts");
  const workflow = read("src/lib/applicant-workflow.ts");
  for (const source of [sheets, candidates, workflow]) assert.match(source, /isPostgresRecruitmentTarget\(\)/);
  assert.match(candidates, /targetBulkResumeQueue/);
  assert.match(workflow, /targetReserveBooking/);
});

test("target API exposes the write contracts needed to keep portal operations out of Sheets", () => {
  const roles = read("src/app/api/internal/recruitment/roles/route.ts");
  const applications = read("src/app/api/internal/recruitment/applications/route.ts");
  const bulk = read("src/app/api/internal/recruitment/bulk/queue/route.ts");
  const slots = read("src/app/api/internal/recruitment/bookings/slots/route.ts");
  const tokens = read("src/app/api/internal/recruitment/bookings/tokens/route.ts");
  assert.match(roles, /export const PATCH/);
  assert.match(applications, /export const PATCH/);
  assert.match(bulk, /enqueueBulkScreening/);
  assert.match(slots, /createInterviewSlot/);
  assert.match(tokens, /export const GET/);
  for (const source of [roles, applications, bulk, slots, tokens]) assert.doesNotMatch(source, /google-sheets|googleapis|DATABASE_URL/);
});

test("target role API normalizes human-facing request type labels before Postgres constraints", () => {
  const source = read("src/app/api/internal/recruitment/roles/route.ts");
  assert.match(source, /normalizeRequestType/);
  assert.match(source, /invalid_request_type/);
});

test("HR decision queue honors the requested stage", () => {
  const route = read("src/app/api/internal/recruitment/hr-decisions/queue/route.ts");
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(route, /searchParams\.get\("stage"\)/);
  assert.match(route, /invalid_stage/);
  assert.match(queries, /stage === "voice"/);
  assert.match(queries, /voice_review_pending/);
});

test("target write primitives are transactional, idempotent, and concurrency-safe", () => {
  const source = read("src/lib/internal-recruitment-queries.ts");
  assert.ok((source.match(/db\.transaction\(/g) || []).length >= 5);
  assert.match(source, /FOR UPDATE SKIP LOCKED/);
  assert.match(source, /onConflictDoNothing/);
  assert.match(source, /actionRequestId/);
  assert.match(source, /isValidTransition/);
  assert.match(source, /current\.currentStage !== expectedStage/);
  assert.match(source, /VOICE_STATUS_TRANSITIONS/);
  assert.match(source, /status = \$\{input\.status\} OR/);
  assert.match(source, /WITH claimed AS/);
});

test("role CRUD routes use the Postgres target for edit and archive", () => {
  const editPage = read("src/app/roles/[roleId]/edit/page.tsx");
  const detailsRoute = read("src/app/api/roles/[roleId]/route.ts");
  const targetPortal = read("src/lib/recruitment-target-portal.ts");
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(editPage, /isPostgresRecruitmentTarget\(\)[\s\S]*targetRoleDetails\(roleId\)/);
  assert.match(detailsRoute, /const updatedFields/);
  assert.match(detailsRoute, /targetUpdateRoleFields\(access\.role\.roleId, updatedFields\)/);
  assert.match(queries, /archive: \{ archivedAt:/);
  assert.match(targetPortal, /isArchivedRole/);
});

test("target role creation persists the complete role and setup snapshot", () => {
  const createRoute = read("src/app/api/roles/route.ts");
  const queries = read("src/lib/internal-recruitment-queries.ts");
  for (const field of ["replacementEmployee", "employmentType", "customScreeningQuestion1", "aiGeneratedScreeningQuestions", "reportingManager", "workLocation", "jobResponsibilities", "requiredSkills", "experienceRequired", "educationRequirements", "preferredQualifications", "roleExpectations", "salaryMin", "salaryMax", "workSchedule", "noticePeriodRequirement", "salaryExpectationGuidance"]) {
    assert.match(createRoute, new RegExp(`${field}:`), `create route omitted ${field}`);
  }
  assert.match(createRoute, /submittedByEmail: sessionEmail/);
  assert.match(createRoute, /recruitmentSetupStatus: "Draft", setup, evaluationFields: setupDraft\.customEvaluationFields/);
  assert.match(createRoute, /evaluationFields: setupDraft\.customEvaluationFields/);
  assert.match(queries, /submittedByEmail: input\.submittedByEmail/);
  assert.match(queries, /setup: \(input\.setup \|\| \{\}\) as object/);
  assert.match(queries, /db\.transaction\(async \(tx\) => \{/);
});

test("role creation and publishing preserve the target hiring date column", () => {
  const createRoute = read("src/app/api/roles/route.ts");
  const setupRoute = read("src/app/api/roles/[roleId]/recruitment-setup/route.ts");
  assert.match(createRoute, /Target_Hiring_Date: input\.targetHiringDate/);
  assert.match(setupRoute, /Target_Hiring_Date: role\.targetHiringDate \|\| ""/);
});

test("pilot target allowlist is explicit and does not use a global bypass", () => {
  const source = read("src/lib/internal-api.ts");
  const env = read(".env.local");
  assert.match(source, /internalEntityAllowed/);
  assert.match(env, /INTERNAL_API_ENTITIES=roles,applicants,applications,screening,screening_invitations,booking,status_history,notifications,voice_attempts,voice_logs,bulk_queue,voice_queue,voice_results,hr_decisions/);
  assert.doesNotMatch(source, /list\.includes\(["']all["']\)/);
});

test("three synthetic pilot scenarios remain the only target seed identities", () => {
  const seed = read("src/db/seed-pilot-dummy-recruitment.mjs");
  for (const id of ["PILOT-DUMMY-APP-A", "PILOT-DUMMY-APP-B", "PILOT-DUMMY-APP-C"]) assert.match(seed, new RegExp(id));
  assert.match(seed, /example\.invalid/);
});

test("target n8n manifest is explicit about inactive versions and rollback evidence", () => {
  const manifest = read("docs/N8N-PILOT-TARGET-MANIFEST-2026-09-04.md");
  assert.match(manifest, /INACTIVE/);
  assert.match(manifest, /rollback/i);
  assert.match(manifest, /29HvXI7H4eKUJ1Uv/);
  assert.match(manifest, /cTJHm2ZAJQap7uWW/);
});
