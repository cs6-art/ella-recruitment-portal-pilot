import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

// ---------------------------------------------------------------------------
// Interview automation rule (role-level auto-advance)
// ---------------------------------------------------------------------------

test("interview automation is off unless explicitly switched on with a start time", async () => {
  const { readInterviewAutomation } = await import("../src/lib/interview-automation.ts");
  assert.equal(readInterviewAutomation({}).enabled, false);
  assert.equal(readInterviewAutomation(null).enabled, false);
  assert.equal(readInterviewAutomation({ interviewAutomation: "yes" }).enabled, false);
  // "on" without a valid enabledAt cannot tell new applicants from the backlog
  assert.equal(readInterviewAutomation({ interviewAutomation: { enabled: true, minScore: 80 } }).enabled, false);
  const on = readInterviewAutomation({ interviewAutomation: { enabled: true, minScore: 75, enabledAt: "2026-10-06T01:00:00.000Z", enabledBy: "hr@example.com" } });
  assert.deepEqual(on, { enabled: true, minScore: 75, enabledAt: "2026-10-06T01:00:00.000Z", enabledBy: "hr@example.com" });
  assert.equal(readInterviewAutomation({ interviewAutomation: { enabled: false, minScore: 500 } }).minScore, 80);
});

test("switching automation on restarts the clock; staying on keeps it; off clears it", async () => {
  const { nextInterviewAutomation, readInterviewAutomation } = await import("../src/lib/interview-automation.ts");
  const off = readInterviewAutomation({});
  const now = new Date("2026-10-06T02:00:00.000Z");
  const on = nextInterviewAutomation(off, { enabled: true, minScore: 82 }, "HR@Example.com", now);
  assert.deepEqual(on, { enabled: true, minScore: 82, enabledAt: now.toISOString(), enabledBy: "hr@example.com" });
  const changed = nextInterviewAutomation(on, { enabled: true, minScore: 90 }, "other@example.com", new Date("2026-10-07T00:00:00.000Z"));
  assert.equal(changed.enabledAt, now.toISOString(), "changing the minimum must not re-start the new-applicant cut-off");
  assert.equal(changed.minScore, 90);
  assert.deepEqual(nextInterviewAutomation(changed, { enabled: false, minScore: 90 }, "hr@example.com"), { enabled: false, minScore: 90, enabledAt: "", enabledBy: "" });
  assert.throws(() => nextInterviewAutomation(off, { enabled: true, minScore: 0 }, "hr@example.com"));
  assert.throws(() => nextInterviewAutomation(off, { enabled: true, minScore: "abc" }, "hr@example.com"));
});

test("auto-advance only invites newly screened Resume Review applicants at or above the minimum", async () => {
  const { evaluateAutoAdvance } = await import("../src/lib/interview-automation.ts");
  const automation = { enabled: true, minScore: 80, enabledAt: "2026-10-06T00:00:00.000Z", enabledBy: "hr@example.com" };
  const base = { currentStage: "resume_review", withdrawn: false, matchScore: 85, screenedAt: "2026-10-06T05:00:00.000Z" };
  assert.deepEqual(evaluateAutoAdvance(automation, base), { advance: true, score: 85 });
  assert.deepEqual(evaluateAutoAdvance(automation, { ...base, matchScore: 80 }), { advance: true, score: 80 });
  assert.deepEqual(evaluateAutoAdvance(automation, { ...base, matchScore: 0.9 }), { advance: true, score: 90 });
  assert.equal(evaluateAutoAdvance(automation, { ...base, matchScore: 79 }).reason, "below_threshold");
  assert.equal(evaluateAutoAdvance(automation, { ...base, matchScore: null }).reason, "no_score");
  assert.equal(evaluateAutoAdvance(automation, { ...base, screenedAt: "2026-10-05T23:59:59.000Z" }).reason, "screened_before_enabled");
  assert.equal(evaluateAutoAdvance(automation, { ...base, screenedAt: null }).reason, "screened_before_enabled");
  assert.equal(evaluateAutoAdvance(automation, { ...base, currentStage: "resume_approved" }).reason, "not_in_resume_review");
  assert.equal(evaluateAutoAdvance(automation, { ...base, withdrawn: true }).reason, "withdrawn");
  assert.equal(evaluateAutoAdvance({ ...automation, enabled: false }, base).reason, "disabled");
});

test("an HR approval below the automatic minimum counts as a manual override", async () => {
  const { isManualOverride } = await import("../src/lib/interview-automation.ts");
  const automation = { enabled: true, minScore: 80, enabledAt: "2026-10-06T00:00:00.000Z", enabledBy: "" };
  assert.equal(isManualOverride(automation, 72), true);
  assert.equal(isManualOverride(automation, null), true);
  assert.equal(isManualOverride(automation, 80), false);
  assert.equal(isManualOverride({ ...automation, enabled: false }, 10), false);
});

test("auto-advance runs after every screening write, never inside the screening transaction", () => {
  const screening = read("src/lib/recruitment-target-screening.ts");
  const finalized = screening.indexOf("await finalizeBulkScreening(");
  const hook = screening.indexOf("await maybeAutoAdvance(applicationId)");
  assert.ok(finalized > 0 && hook > finalized, "bulk screening hook must follow the committed finalizeBulkScreening call");
  assert.match(read("src/app/api/internal/recruitment/screening/route.ts"), /await maybeAutoAdvance\(String\(body\.applicationExternalId\)\)/);
  for (const file of ["src/app/api/applicants/route.ts", "src/app/api/public/applications/route.ts"]) {
    assert.match(read(file), /if \(reused\) await maybeAutoAdvance\(applicationId\);/, `${file} must apply automation to a reused CV analysis`);
  }
  assert.doesNotMatch(read("src/lib/internal-recruitment-queries.ts"), /maybeAutoAdvance/);
});

test("auto-advance is idempotent, audited and retried", () => {
  const autoAdvance = read("src/lib/auto-advance.ts");
  assert.match(autoAdvance, /actionRequestId: `auto-advance:resume:\$\{id\}`/);
  assert.match(autoAdvance, /mode: "auto"/);
  assert.match(autoAdvance, /catch \(error\)[\s\S]*the sweep will retry/);
  assert.match(autoAdvance, /listApprovedWithoutInterviewInvitation/);
  assert.match(read("src/lib/recruitment-target-portal.ts"), /auto: "auto:screening_condition"/);
  const labels = read("src/lib/applicant-stage-labels.ts");
  assert.match(labels, /"auto:screening_condition": "Automatically approved — screening condition met"/);
  assert.match(labels, /"portal:manual_override": "Approved by HR — manual override"/);
  const crons = JSON.parse(read("vercel.json")).crons.map((cron) => cron.path);
  assert.ok(crons.includes("/api/cron/auto-advance"));
  assert.match(read("src/app/api/cron/auto-advance/route.ts"), /CRON_SECRET/);
});

test("interview automation is configured per role by HR and stored only under its own setup key", () => {
  const route = read("src/app/api/roles/[roleId]/interview-automation/route.ts");
  assert.match(route, /canEditRecruitmentSetup\(user\)/);
  assert.match(route, /getRole\(roleId, user\.organizationId\)/);
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(queries, /jsonb_set\(coalesce\(\$\{roles\.setup\}, '\{\}'::jsonb\), '\{interviewAutomation\}'/);
  assert.match(read("src/components/RoleDetails.tsx"), /<InterviewAutomationCard roleId=\{role\.roleId\} editable=\{canReviewRole\} \/>/);
});

// ---------------------------------------------------------------------------
// Organization-scoped decisions and bulk approval
// ---------------------------------------------------------------------------

test("HR decisions are limited to the signed-in organization", () => {
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(queries, /and\(eq\(applications\.externalId, input\.applicationExternalId\), eq\(applications\.organizationId, organizationId\)\)/);
  assert.match(read("src/app/api/applicants/[applicationId]/decision/route.ts"), /\{ organizationId: user\.organizationId, approvalMode \}/);
  assert.match(read("src/lib/recruitment-target-portal.ts"), /const organizationId = input\.organizationId \|\| await targetOrganizationId\(\);/);
});

test("bulk approval is one server request with per-applicant outcomes and tenant checks", () => {
  const route = read("src/app/api/applicants/bulk-approve/route.ts");
  assert.match(route, /canDecideApplicant\(user\)/);
  assert.match(route, /row\.application\.organizationId !== user\.organizationId\) outcome = "not_found"/);
  assert.match(route, /actionRequestId: `bulk-approve:\$\{batchId\}:\$\{applicationId\}`/);
  assert.match(route, /mode: override \? "manual_override" : "bulk"/);
  assert.match(route, /consumeRateLimit\(/);
  const list = read("src/components/ApplicantsList.tsx");
  assert.match(list, /fetch\("\/api\/applicants\/bulk-approve"/);
  assert.match(list, /Approve for Interview/);
  assert.doesNotMatch(list, /for \(const applicationId of ids\)[\s\S]{0,200}bulk-approve/, "approval must not loop per applicant in the browser");
});

test("bulk approval summary reads like the HR message", async () => {
  const { summarizeBulkApproval, MAX_BULK_APPROVAL } = await import("../src/lib/bulk-approval.ts");
  assert.equal(MAX_BULK_APPROVAL, 100);
  const summary = summarizeBulkApproval(["approved", "approved", "approved", "approved", "approved", "approved", "approved", "approved", "interview_exists"]);
  assert.equal(summary.message, "8 applicants approved for interview. 1 applicant skipped because an interview already exists.");
  assert.equal(summary.counts.approved, 8);
  assert.equal(summarizeBulkApproval(["failed"]).message, "No applicants were approved. 1 applicant could not be approved. Please try again.");
  assert.match(summarizeBulkApproval(["approved", "already_approved"]).message, /1 applicant was already approved for interview\./);
});

// ---------------------------------------------------------------------------
// Overdue roles
// ---------------------------------------------------------------------------

test("a role is overdue only after its target date has fully passed in Singapore time", async () => {
  const { isRoleTargetDatePassed, isRoleOpenForSelection } = await import("../src/lib/recruitment-role-eligibility.ts");
  // 2026-10-06 23:59:59 SGT is still the target day
  assert.equal(isRoleTargetDatePassed("2026-10-06", new Date("2026-10-06T15:59:59.000Z")), false);
  // 2026-10-07 00:00 SGT is the next day
  assert.equal(isRoleTargetDatePassed("2026-10-06", new Date("2026-10-06T16:00:00.000Z")), true);
  assert.equal(isRoleTargetDatePassed("2026-10-07", new Date("2026-10-06T16:00:00.000Z")), false);
  assert.equal(isRoleTargetDatePassed("", new Date()), false);
  assert.equal(isRoleTargetDatePassed("not a date", new Date()), false);
  assert.equal(isRoleOpenForSelection({ targetHiringDate: "2000-01-01" }), false);
  assert.equal(isRoleOpenForSelection({}), true);
});

test("overdue roles are hidden from pickers and rejected for new work, but kept for history", () => {
  for (const file of ["src/app/resume-screening/page.tsx", "src/app/apply/page.tsx", "src/app/api/public/roles/route.ts", "src/app/apply/[roleId]/page.tsx", "src/components/BookingsList.tsx"]) {
    assert.match(read(file), /isRoleOpenForSelection\(role\)/, `${file} must hide overdue roles`);
  }
  for (const file of ["src/app/api/applicants/route.ts", "src/app/api/roles/[roleId]/resume-screening/invite/route.ts"]) {
    assert.match(read(file), /ROLE_TARGET_DATE_PASSED_MESSAGE/, `${file} must reject overdue roles`);
  }
  // The Applicants role filter keeps overdue roles so their history stays reachable.
  assert.doesNotMatch(read("src/app/applicants/page.tsx"), /isRoleOpenForSelection/);
});

// ---------------------------------------------------------------------------
// Interview Calendar rename and dashboard alerts
// ---------------------------------------------------------------------------

test("HR navigation says Interview Calendar, while the /bookings route is unchanged", () => {
  const shell = read("src/components/AppShell.tsx");
  assert.match(shell, /href="\/bookings"[^>]*>.*<span>Interview Calendar<\/span>/);
  assert.doesNotMatch(shell, /<span>Bookings<\/span>/);
  assert.match(read("src/components/BookingsList.tsx"), /<h1>Interview Calendar<\/h1>/);
  assert.doesNotMatch(read("src/lib/dashboard-attention.ts"), /Review bookings/);
});

test("each dashboard alert is one clickable card with a specific destination", () => {
  const dashboard = read("src/components/DashboardMetrics.tsx");
  assert.match(dashboard, /<Link className="dashboard-alert-row dashboard-alert-link" href=\{alert\.href\}>/);
  assert.match(dashboard, /<section id="dashboard-alerts"/, "the Open alerts KPI links to #dashboard-alerts, so the section must carry that id");
  const attention = read("src/lib/dashboard-attention.ts");
  const hrefs = [...attention.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(hrefs.length >= 7);
  // /credits is itself the destination (top up); every other alert opens a filtered view or section.
  for (const href of hrefs.filter((value) => value !== "/credits")) assert.ok(/[?#]/.test(href), `alert link ${href} must open a filtered view or section`);
  assert.match(read("src/app/api/applicants/route.ts"), /params\.get\("attention"\)/);
  assert.match(read("src/components/ApplicantsList.tsx"), /This alert refers to records that are no longer available/);
});

// ---------------------------------------------------------------------------
// Per-user new-applicant read state (server side)
// ---------------------------------------------------------------------------

test("new-applicant read state is stored per user on the server", () => {
  const migration = read("drizzle/0039_applicant_seen_state.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "applicant_seen"/);
  assert.match(migration, /REFERENCES "applications"\("id"\) ON DELETE CASCADE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "user_notification_state"/);
  const seen = read("src/lib/applicant-seen.ts");
  assert.match(seen, /eq\(applications\.organizationId, id\.organizationId\)/);
  assert.match(read("src/app/api/applicants/[applicationId]/seen/route.ts"), /markApplicantSeen\(user\.organizationId, user\.email, applicationId\)/);
  assert.match(read("src/app/api/notifications/applicants/read-all/route.ts"), /markAllApplicantsSeen\(user\.organizationId, user\.email\)/);
  assert.match(read("src/app/api/applicants/recent/route.ts"), /listUnseenApplicants\(user\.organizationId, user\.email/);
});

test("opening one applicant no longer clears the others", () => {
  const bell = read("src/components/NewApplicantsBell.tsx");
  // The panel-close watermark write is legacy (Sheets) only.
  assert.match(bell, /if \(!serverReadState && wasOpen\.current && !open\) writeApplicantsLastSeen\(userEmail\);/);
  assert.match(bell, /Mark all as read/);
  assert.match(read("src/components/MarkApplicantSeen.tsx"), /\/seen`, \{ method: "POST"/);
  assert.match(read("src/app/applicants/[applicationId]/page.tsx"), /<MarkApplicantSeen applicationId=\{applicant\.applicationId\} \/>/);
  assert.match(read("src/components/ApplicantsList.tsx"), /if \(applicantFeed\.serverReadState\) return new Set\(applicantFeed\.newApplicants\.map/);
});

// ---------------------------------------------------------------------------
// Google Calendar: strict booking, resilient everything else
// ---------------------------------------------------------------------------

test("face-to-face booking still requires a connected HR calendar (strict rule)", () => {
  const target = read("src/lib/recruitment-target-portal.ts");
  assert.match(target, /calendar\.reason === "not_connected" \? "calendar_not_connected"/);
  assert.match(target, /if \(!busy\.checked\) \{[\s\S]{0,200}Connect or reconnect Google Calendar/);
});

test("calendar status distinguishes reconnect from temporary outages without raw errors", () => {
  const calendar = read("src/lib/google-calendar.ts");
  assert.match(calendar, /export function classifyCalendarError/);
  assert.match(calendar, /invalid_grant/);
  assert.match(calendar, /state: authorized \? "connected" : "needs_reconnect"/);
  const connect = read("src/components/GoogleCalendarConnect.tsx");
  assert.match(connect, /Google Calendar needs to be reconnected/);
  assert.match(connect, /Reconnect Google Calendar/);
  assert.doesNotMatch(read("src/components/BookingsList.tsx"), /booking\.calendarEventError \|\|/, "raw Google errors must not be shown to HR");
});

test("HR reschedule and cancel change the portal first and report Google sync separately", () => {
  const route = read("src/app/api/interviews/[slotId]/route.ts");
  assert.match(route, /canManagePipeline\(user\)/);
  assert.match(route, /organizationId: user\.organizationId/);
  const target = read("src/lib/recruitment-target-portal.ts");
  const moved = target.indexOf("await rescheduleFinalInterviewSlot(");
  const synced = target.indexOf("await updateFinalInterviewEvent(");
  assert.ok(moved > 0 && synced > moved, "the portal record must change before Google is updated");
  assert.match(target, /Interview rescheduled in the portal\. Google Calendar could not be updated/);
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(queries, /source: "portal:interview_rescheduled"/);
  assert.match(queries, /source: "portal:interview_cancelled"/);
  assert.match(queries, /eq\(interviewSlots\.organizationId, input\.organizationId\.trim\(\)\)/);
});
