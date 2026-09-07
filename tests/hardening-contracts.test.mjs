import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const authSource = fs.readFileSync("src/app/api/auth/google/route.ts", "utf8");
const logoutSource = fs.readFileSync("src/app/api/auth/logout/route.ts", "utf8");
const statusSource = fs.readFileSync("src/app/api/roles/[roleId]/status/route.ts", "utf8");
const setupSource = fs.readFileSync("src/app/api/roles/[roleId]/recruitment-setup/route.ts", "utf8");
const promptSource = fs.readFileSync("src/lib/recruitment-prompt.ts", "utf8");
const demoModeSource = fs.readFileSync("src/lib/demo-mode.ts", "utf8");
const demoDataSource = fs.readFileSync("src/lib/demo-data.ts", "utf8");
const candidateApplicationsSource = fs.readFileSync("src/lib/candidate-applications.ts", "utf8");
const applicantWorkflowSource = fs.readFileSync("src/lib/applicant-workflow.ts", "utf8");
const calendarSource = fs.readFileSync("src/lib/google-calendar.ts", "utf8");
const roleSheetSource = fs.readFileSync("src/lib/google-sheets.ts", "utf8");
const hrApplicantRouteSource = fs.readFileSync("src/app/api/applicants/route.ts", "utf8");
const publicApplicantRouteSource = fs.readFileSync("src/app/api/public/applications/route.ts", "utf8");

test("authentication and logout use secure HTTP-only cookie settings", () => {
  assert.match(authSource, /httpOnly: true/);
  assert.match(authSource, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(authSource, /maxAge: 8 \* 60 \* 60/);
  assert.match(logoutSource, /httpOnly: true/);
  assert.match(logoutSource, /sameSite: "lax"/);
});

test("demo mode keeps history out of the default list but exposes read-only stage examples", () => {
  assert.match(demoModeSource, /allowing new test roles and applicants/);
  assert.match(demoModeSource, /2026-08-20T00:00:00\+08:00/);
  assert.doesNotMatch(demoModeSource, /Intl\.DateTimeFormat/);
  assert.match(candidateApplicationsSource, /APP-\(\?:BULK-/);
  assert.match(candidateApplicationsSource, /return isDemoWindowRecord\(field\(/);
  assert.match(candidateApplicationsSource, /function withDemoHistory\(rows: SheetRow\[\]\)/);
  assert.match(candidateApplicationsSource, /\[\.\.\.demoApplicantRows\(\), \.\.\.recentLive\]/);
  assert.match(candidateApplicationsSource, /function withDemoApplicantList\(rows: SheetRow\[\]\)/);
  assert.match(candidateApplicationsSource, /APP-\(\?:BULK-\|\\d\{13\}-\[A-Z0-9\]\{6\}\)/);
  assert.match(candidateApplicationsSource, /const operational = withDemoApplicantList\(live\)/);
  assert.match(candidateApplicationsSource, /const historical = isDemoMode\(\)/);
  assert.match(candidateApplicationsSource, /map\(\(record\) => mapApplicant\(record, true\)\)/);
  assert.match(candidateApplicationsSource, /const rows = withDemoHistory\(\(await readTab\("High_Match_Profile", "CZ"\)\)\.rows\)/);
  assert.match(candidateApplicationsSource, /"Date_of_Application"/);
  assert.match(candidateApplicationsSource, /\[\.\.\.demoInterviewBookings\(\), \.\.\.recentLive\]/);
  assert.match(hrApplicantRouteSource, /invalidateSheetsCache\("High_Match_Profile"\)/);
  assert.match(publicApplicantRouteSource, /invalidateSheetsCache\("High_Match_Profile"\)/);
  assert.match(candidateApplicationsSource, /Guards destructive profile edits/);
  assert.match(candidateApplicationsSource, /Records from August 20, 2026 onward can be edited normally/);
  assert.match(candidateApplicationsSource, /new Set\(\[\.\.\.demoIds, \.\.\.voice\]\)/);
  assert.match(applicantWorkflowSource, /Demo mode accepts new applicants/);
  assert.match(applicantWorkflowSource, /isDemoSideEffectAllowed\(context\.appliedAt\)/);
  assert.match(applicantWorkflowSource, /appliedAt: field\([\s\S]*"Date of Application"/);
  assert.match(applicantWorkflowSource, /scheduledAt[\s\S]*isDemoSideEffectAllowed\(scheduledAt\.toISOString\(\)\)/);
  assert.match(calendarSource, /reason: "demo_mode"/);
  assert.match(demoDataSource, /function nextWeekday/);
  assert.match(demoDataSource, /return random\(\) < 0\.08 \? "No Show" : "Completed"/);
});

test("candidate intake exposes only roles with durable publication evidence", () => {
  const roleEligibilitySource = fs.readFileSync("src/lib/recruitment-role-eligibility.ts", "utf8");
  assert.match(roleSheetSource, /export function isPublishedRoleForIntake/);
  assert.match(roleEligibilitySource, /postingConfirmed === "true" \|\| text\(role\.postedAt\) !== ""/);
  assert.match(roleSheetSource, /"Posting_Confirmed"/);
  assert.match(roleSheetSource, /"Posted_At"/);
});

test("status and setup payloads preserve idempotency and event contracts", () => {
  assert.match(statusSource, /eventType: "role_status_transition"/);
  assert.match(statusSource, /X-Idempotency-Key/);
  assert.match(setupSource, /eventType: "recruitment_setup_updated"/);
  assert.match(setupSource, /X-Idempotency-Key/);
});

test("structured Recruitment Setup can generate a readable prompt", () => {
  assert.match(promptSource, /Job description/);
  assert.match(promptSource, /KEYWORDS TO LOOK FOR/);
  assert.match(promptSource, /LICENSE OR CERTIFICATE REQUIRED/);
  assert.match(promptSource, /\{\{interview_questions\}\}/);
  assert.match(promptSource, /\{\{system_prompt\}\}/);
});

test("the generated prompt no longer depends on the retired voice sub-fields", () => {
  for (const retired of ["aiInterviewerBehavior", "interviewBehavior", "finalAiEvaluationTemplate", "initialInterviewQuestions"]) {
    assert.doesNotMatch(promptSource, new RegExp(retired));
  }
});

test("Recruitment Setup keeps one editable VAPI prompt plus the three required questions", () => {
  const schema = fs.readFileSync("src/lib/recruitment-setup-schema.ts", "utf8");
  const readiness = fs.readFileSync("src/lib/recruitment-setup-readiness.ts", "utf8");
  const setupApi = fs.readFileSync("src/app/api/roles/[roleId]/recruitment-setup/route.ts", "utf8");
  for (const field of ["aiSystemPrompt", "requiredInterviewQuestion1", "requiredInterviewQuestion2", "requiredInterviewQuestion3"]) assert.match(schema, new RegExp(field));
  for (const retired of ["aiInterviewerName", "aiInterviewerBehavior", "finalAiEvaluationTemplate", "initialInterviewQuestions", "interviewBehavior"]) assert.doesNotMatch(schema, new RegExp(retired));
  assert.match(readiness, /AI_System_Prompt/);
  assert.doesNotMatch(readiness, /AI_Interviewer_Name/);
  assert.doesNotMatch(readiness, /Final_AI_Evaluation_Template/);
  assert.match(setupApi, /Status: setupAction === "publish_role" \? "Job Posted"/);
  assert.match(setupApi, /Recruitment_Setup_Status: setupStatusForAction/);
});
