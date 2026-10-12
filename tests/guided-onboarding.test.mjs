import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { computeOnboarding, CORE_STEPS, derivedCompletions, newlyCompletedSteps } from "../src/lib/onboarding.ts";

const read = (file) => fs.readFileSync(file, "utf8");

const facts = (over = {}) => ({
  roleCount: 0,
  publishedRoleCount: 0,
  applicationCount: 0,
  screenedCount: 0,
  decidedCount: 0,
  unpublishedRoleId: "",
  unpublishedRoleStatus: "",
  latestApplicationId: "",
  latestScreenedApplicationId: "",
  interviewInvitationsSent: false,
  hasInterviewEvidence: false,
  calendarConnected: false,
  ...over,
});

const guided = (over = {}, persisted = {}, extra = {}) => computeOnboarding({ guided: true, facts: facts(over), persisted, canAct: true, ...extra });

test("a fresh organization starts at step 1 with every later step locked", () => {
  const state = guided();
  assert.equal(state.mode, "guided");
  assert.equal(state.status, "not_started");
  assert.equal(state.currentStep, "create_role");
  assert.deepEqual(state.steps.map((step) => step.state), ["current", "locked", "locked", "locked", "locked"]);
  assert.equal(state.completedCount, 0);
  assert.equal(state.percent, 0);
  assert.equal(state.next.label, "Create Your First Role Request");
  assert.match(state.next.href, /^\/roles\/new\?guide=sample-jd$/);
  assert.deepEqual(state.lockedNav, ["resume-screening", "applicants"]);
  assert.equal(state.guidedNav, "roles");
  assert.ok(state.steps.slice(1).every((step) => step.lockedReason), "every locked step explains its prerequisite");
});

test("steps unlock one at a time from real records only", () => {
  const draft = guided({ roleCount: 1, unpublishedRoleId: "ROLE-1", unpublishedRoleStatus: "draft" });
  assert.equal(draft.currentStep, "publish_role");
  assert.equal(draft.next.href, "/roles/ROLE-1/edit?guide=publish-role");
  assert.deepEqual(draft.lockedNav, ["resume-screening", "applicants"]);

  const pending = guided({ roleCount: 1, unpublishedRoleId: "ROLE-1", unpublishedRoleStatus: "approved" });
  assert.equal(pending.next.href, "/roles/ROLE-1?guide=publish-role");

  const published = guided({ roleCount: 1, publishedRoleCount: 1 });
  assert.equal(published.currentStep, "add_candidate");
  assert.equal(published.guidedNav, "resume-screening");
  assert.deepEqual(published.lockedNav, ["applicants"]);
  assert.match(published.next.href, /^\/resume-screening\?guide=sample-resume$/);

  const submitted = guided({ roleCount: 1, publishedRoleCount: 1, applicationCount: 1, latestApplicationId: "APP-1" });
  assert.equal(submitted.currentStep, "screen_resume");
  assert.equal(submitted.steps[3].state, "waiting", "screening is asynchronous: shown as in progress, not as an action");
  assert.equal(submitted.screeningPending, true);
  assert.deepEqual(submitted.lockedNav, []);

  const screened = guided({ roleCount: 1, publishedRoleCount: 1, applicationCount: 1, screenedCount: 1, latestScreenedApplicationId: "APP-1" });
  assert.equal(screened.currentStep, "review_applicant");
  assert.equal(screened.next.href, "/applicants/APP-1?guide=review-results");
  assert.equal(screened.screeningPending, false);
  assert.equal(screened.percent, 80);
});

test("opening a page never completes a step: a failed screening leaves step 4 open", () => {
  // An application exists but no screening result was stored (e.g. parsing failed).
  const state = guided({ roleCount: 1, publishedRoleCount: 1, applicationCount: 1 });
  assert.equal(state.steps.find((step) => step.key === "screen_resume").state, "waiting");
  assert.notEqual(state.status, "completed");
});

test("review completes from an explicit confirmation or a real HR decision", () => {
  const base = { roleCount: 1, publishedRoleCount: 1, applicationCount: 1, screenedCount: 1 };
  assert.equal(guided(base, { steps: { review_applicant: "2026-10-12T00:00:00Z" } }).status, "completed");
  assert.equal(guided({ ...base, decidedCount: 1 }).status, "completed");
  assert.equal(guided(base).status, "in_progress");
});

test("completed steps stay complete even if the records are later archived or deleted", () => {
  const persisted = { steps: { create_role: "t", publish_role: "t", add_candidate: "t", screen_resume: "t" } };
  const state = guided({}, persisted);
  assert.equal(state.currentStep, "review_applicant");
  assert.deepEqual(state.lockedNav, [], "no page re-locks");
  const done = guided({}, { ...persisted, steps: { ...persisted.steps, review_applicant: "t" }, completedAt: new Date().toISOString() });
  assert.equal(done.status, "completed");
  assert.deepEqual(done.lockedNav, []);
  assert.equal(done.guidedNav, null);
});

test("only newly evidenced steps are written back", () => {
  const state = guided({ roleCount: 1, publishedRoleCount: 1 }, { steps: { create_role: "earlier" } });
  assert.deepEqual(newlyCompletedSteps(state, { steps: { create_role: "earlier" } }), ["publish_role"]);
  assert.deepEqual([...derivedCompletions(facts({ screenedCount: 1 }))].sort(), ["add_candidate", "screen_resume"]);
});

test("established organizations are never guided or locked", () => {
  const state = computeOnboarding({ guided: false, facts: facts(), persisted: {}, canAct: true });
  assert.equal(state.mode, "standard");
  assert.deepEqual(state.lockedNav, []);
  assert.equal(state.guidedNav, null);
  assert.equal(state.showCompletionCard, false);
});

test("the completion card shows once, can be dismissed, and expires", () => {
  const all = { roleCount: 1, publishedRoleCount: 1, applicationCount: 1, screenedCount: 1, decidedCount: 1 };
  assert.equal(guided(all, { completedAt: new Date().toISOString() }).showCompletionCard, true);
  assert.equal(guided(all, { completedAt: new Date().toISOString(), completionDismissedAt: new Date().toISOString() }).showCompletionCard, false);
  assert.equal(guided(all, { completedAt: "2020-01-01T00:00:00Z" }).showCompletionCard, false);
});

test("a teammate without recruitment access sees progress but cannot act", () => {
  const state = computeOnboarding({ guided: true, facts: facts(), persisted: {}, canAct: false });
  assert.equal(state.canAct, false);
  assert.equal(state.currentStep, "create_role", "the organization's real progress is shown, not a personal restart");
});

test("sample recommendations map only roles this organization recorded", () => {
  const state = guided({}, { sampleRoles: { "uuid-1": "sales-executive", "uuid-2": "accounts-executive" } }, { roleExternalIds: { "uuid-1": "ROLE-SALES" } });
  assert.deepEqual(state.sampleRecommendations, { "ROLE-SALES": "sales-executive" });
});

test("optional interview activities never block completion", () => {
  const state = guided({ roleCount: 1, publishedRoleCount: 1, applicationCount: 1, screenedCount: 1, decidedCount: 1 });
  assert.equal(state.status, "completed");
  assert.equal(state.optional.length, 3);
  assert.ok(state.optional.every((item) => item.requirements.length > 0), "each optional activity lists its prerequisites");
  assert.equal(CORE_STEPS.length, 5);
});

test("the onboarding API is tenant-scoped and grants no new permission", () => {
  const route = read("src/app/api/onboarding/route.ts");
  assert.match(route, /getOnboardingState\(user\.organizationId/);
  assert.match(route, /acknowledge_review[\s\S]*user\.canReviewRole !== true/);
  assert.match(route, /record_sample_role[\s\S]*user\.canCreateRole !== true/);
  assert.doesNotMatch(route, /organizationId:\s*z\./, "the organization always comes from the session, never the request");
  const store = read("src/lib/onboarding-store.ts");
  assert.match(store, /a\.organization_id = \$\{organizationId\} AND s\.organization_id = \$\{organizationId\}/, "a review can only be confirmed for this organization's screened applicant");
  assert.match(store, /WHERE organization_id = \$\{organizationId\} AND external_id = \$\{roleExternalId\}/);
  // Earlier timestamps win so completion is permanent and concurrent writers are harmless.
  assert.match(store, /\$\{steps\}::jsonb \|\| COALESCE\(onboarding_progress->'steps'/);
});

test("the progress column is optional until migration 0043 is applied", () => {
  const migration = read("drizzle/0043_organization_onboarding_progress.sql");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "onboarding_progress" jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.doesNotMatch(read("src/db/schema.ts"), /onboarding_progress/, "kept out of the Drizzle model so other organization queries never depend on it");
  assert.match(read("src/lib/onboarding-store.ts"), /catch \(error\) \{\s*console\.warn\("\[Onboarding\] Progress column unavailable/);
});

test("a new organization without a connected calendar can still submit its first role", async () => {
  const { z } = await import("zod");
  const source = read("src/lib/role-schema.ts");
  const rule = source.match(/hodEmail: (z\.string\(\)[^\r\n]+),\r?\n/)?.[1];
  assert.ok(rule, "hodEmail rule present");
  const hodEmail = new Function("z", `return ${rule};`)(z);
  assert.equal(hodEmail.parse(""), "", "empty until the calendar is connected");
  assert.equal(hodEmail.parse(" HR@Example.com "), "hr@example.com");
  assert.equal(hodEmail.safeParse("not-an-email").success, false);
});
