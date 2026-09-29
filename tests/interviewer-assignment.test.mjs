import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("an assigned interviewer's calendar is used only when connected, otherwise the shared HR calendar", () => {
  const calendar = read("src/lib/google-calendar.ts");
  assert.match(calendar, /assigned !== normalizedEmail\(configured\.email \|\| ""\) && await getCalendarConnection\(assigned\)/);
  assert.match(calendar, /email: configured\.email \|\| assigned/);
  assert.match(calendar, /export async function resolveFinalInterviewCalendarEmail/);
});

test("role saves keep the assigned interviewer instead of resetting to the shared calendar", () => {
  const target = read("src/lib/recruitment-target-portal.ts");
  assert.match(target, /hrCalendarEmail: text\(setup\.interviewerEmail\) \|\| fields\.HOD_Email/);
  assert.match(target, /\.\.\.\(await interviewerLabelFor\(context\.roleHrCalendarEmail, organizationId\)\)/);
  assert.match(target, /eq\(users\.email, normalizedEmail\), eq\(users\.organizationId, organizationId\)/);
  assert.match(target, /interviewerNamesForOrganization\(organizationId\)/);
  assert.match(target, /interviewerNameForSlot\(slot, interviewerNames\)/);
  assert.match(target, /directoryInterviewerName\(text\(finalSlot\.interviewerEmail\), organizationId\)/);
  assert.match(target, /interviewer_name: finalSlot\s*\?\s*interviewerNameForSlot\(finalSlot,/);
});

test("assignment requires an eligible HR reviewer with a connected calendar and HR edit access", () => {
  const route = read("src/app/api/roles/[roleId]/interviewer/route.ts");
  assert.match(route, /canEditRecruitmentSetup\(user\)/);
  assert.match(route, /listEligibleInterviewers\(user\.organizationId\)/);
  assert.match(route, /has not connected their Google Calendar yet/);
  const list = read("src/lib/interviewers.ts");
  assert.match(list, /!user\.active \|\| !user\.canReviewRole/);
});

test("any HR reviewer can connect only their own calendar; the shared one stays admin-only", () => {
  const connect = read("src/app/api/auth/google-calendar/connect/route.ts");
  assert.match(connect, /searchParams\.get\("self"\) === "1"/);
  assert.match(connect, /user\.canReviewRole !== true/);
  assert.match(connect, /user\.canEditSettings !== true/);
  assert.match(connect, /self \? \{ email: user\.email\.trim\(\)\.toLowerCase\(\) \}/);
  const disconnect = read("src/app/api/auth/google-calendar/disconnect/route.ts");
  assert.match(disconnect, /self \? \{ email: user\.email\.trim\(\)\.toLowerCase\(\) \}/);
});

test("setup checklist checks email delivery and team invites", () => {
  const steps = read("src/components/GettingStarted.tsx");
  assert.match(steps, /key: "email"/);
  assert.match(steps, /key: "team"/);
  assert.match(read("src/app/api/notifications/health/route.ts"), /pilotOutboundEmailEnabled\(\)/);
});
