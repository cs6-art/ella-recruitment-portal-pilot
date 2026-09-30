import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("every registration is HR with full access except credit top-ups", () => {
  const roles = read("src/lib/access-roles.ts");
  const registration = read("src/lib/registration.ts");
  const block = roles.match(/export const HR_FULL_ACCESS[\s\S]*?\};/)[0];
  for (const flag of ["canCreateRole", "canReviewRole", "canApproveRole", "canEditSettings", "canManageUsers"]) {
    assert.match(block, new RegExp(`${flag}: true`));
  }
  assert.match(block, /canManageCredits: false/);
  assert.match(registration, /accessRole: "HR"/);
  assert.match(registration, /\.\.\.HR_FULL_ACCESS/);
});

test("platform administration is limited to McLink staff and never follows from registration", () => {
  const control = read("src/lib/access-control.ts");
  const login = read("src/app/api/auth/login/route.ts");
  const orgs = read("src/app/api/organizations/route.ts");
  const directory = read("src/app/api/user-directory/route.ts");
  assert.match(control, /export function isPlatformAdmin/);
  assert.match(control, /user\.platformAdmin === true/);
  assert.match(login, /directory\?\.source === "sheet"/);
  assert.match(orgs, /isPlatformAdmin\(user\)/);
  assert.match(directory, /isPlatformAdmin\(user\)/);
  // A non-platform HR can only rename, re-department or deactivate a colleague.
  assert.match(directory, /Teammates join by registering/);
  assert.match(directory, /Object\.assign\(normalizedUser, current/);
});

test("organizations own their registration rules so new ones need no code", () => {
  const orgs = read("src/app/api/organizations/route.ts");
  const editor = read("src/components/UserAccountsEditor.tsx");
  assert.match(orgs, /allowedDomains/);
  assert.match(orgs, /allowedEmails/);
  assert.match(orgs, /already belongs to/);
  assert.match(editor, /organization-domains/);
  assert.match(editor, /organization-emails/);
});

test("role requests no longer offer return or hold, and approval needs no comment", () => {
  const route = read("src/app/api/roles/[roleId]/status/route.ts");
  const review = read("src/components/HrReview.tsx");
  assert.doesNotMatch(route, /return_for_revision_hr|place_on_hold_hr|resume_hr_review/);
  assert.match(route, /LEGACY_PAUSED_STATUSES/);
  assert.match(route, /Tell the requester why/);
  assert.doesNotMatch(review, /resume_hr_review/);
  assert.match(review, /"approve_role", "reject_role"/);
});

test("approvers get their new request approved on submission", () => {
  const form = read("src/components/RoleRequestForm.tsx");
  assert.match(form, /canApproveRole && \(!isEditing \|\| isDraftRole\)/);
  assert.match(form, /Submit & approve/);
});

test("forms flow in a single column", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /\.form-grid, \.grid-2, \.user-account-form \{ grid-template-columns: 1fr; \}/);
  const form = read("src/components/RoleRequestForm.tsx");
  assert.doesNotMatch(form, /className="grid-2"/);
});

test("the single Create Role form captures setup details without a separate Publishing section", () => {
  const form = read("src/components/RoleRequestForm.tsx");
  const newPage = read("src/app/roles/new/page.tsx");
  const editPage = read("src/app/roles/[roleId]/edit/page.tsx");
  assert.match(form, /unified\?: boolean/);
  assert.match(form, /Create role saves these settings/);
  assert.match(form, /"Create role"/);
  assert.match(form, /Save as draft/);
  assert.match(form, /setupAction: "publish_role"|setupPayload\("publish_role"\)/);
  assert.match(form, /recruitment-setup`/);
  assert.match(form, /id="setup_salaryDisclosureStatus"/);
  assert.match(form, /id="setup_minimumYearsOfExperience"/);
  assert.match(form, /id="setup_keywordsToLookFor"/);
  assert.match(form, /id="setup_transferableSkillsAccepted"/);
  assert.match(form, /id="setup_earliestAvailabilityRule"/);
  assert.match(form, /id="setup_licenseRequirementStatus"/);
  assert.match(form, /id="setup_hodInterviewRequired"/);
  assert.match(form, /salaryRangeMissing/);
  assert.match(form, /const effectiveLicenseStatus = licenseStatus/);
  assert.match(form, /const effectiveInterviewStatus = interviewStatus/);
  assert.doesNotMatch(form, /<h2>Publishing<\/h2>/);
  assert.doesNotMatch(form, /POSTING CHANNELS|setup_channels/);
  assert.doesNotMatch(form, /adjusted later in Recruitment Setup/);
  // Publishing only proceeds once the role is approved.
  assert.match(form, /finalStatus !== "Approved"/);
  assert.match(newPage, /unified=\{user\.canReviewRole === true && user\.canApproveRole === true\}/);
  assert.match(editPage, /role\.status === "Draft"/);
  // Role, screening, and interview requirements are collected before one create action.
  assert.ok(form.indexOf("Screening and Interview") < form.indexOf("Create role saves these settings"));
});

test("shared portal settings are platform-administrator only and show what is in effect", () => {
  const api = read("src/app/api/settings/route.ts");
  const page = read("src/app/settings/page.tsx");
  const editor = read("src/components/SettingsEditor.tsx");
  assert.match(api, /isPlatformAdmin\(user\)/);
  assert.match(page, /isPlatformAdmin\(user\)/);
  assert.match(editor, /effectiveValue/);
  assert.match(editor, /type="number"/);
  const editableKeys = api.match(/const editableSettingKeys = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";
  assert.match(editableKeys, /"Voice_Call_Max_Attempts"/);
  assert.match(editableKeys, /"Voice_Call_Retry_Gap_Hours"/);
  assert.match(editor, /Maximum AI phone call attempts/);
  assert.match(editor, /Wait between unanswered call attempts \(hours\)/);
  assert.match(api, /settingsForEditor\(merged\)/);
  assert.match(editor, /usually within 20 seconds/);
  assert.match(editor, /Existing booking links and appointments are not changed/);
});

test("the dashboard shows the database-backed setup checklist only for newly created organizations", () => {
  const card = read("src/components/GettingStarted.tsx");
  const metrics = read("src/components/DashboardMetrics.tsx");
  const dashboard = read("src/app/dashboard/page.tsx");
  const lib = read("src/lib/dashboard-metrics.ts");
  for (const step of ["Review organization name and branding", "Add Smile Credits", "Configure Google Drive for Live Avatar recordings", "Connect Google Calendar", "Create and publish your first role", "Add candidates", "Invite teammates", "Customize automated emails"]) assert.match(card, new RegExp(step));
  assert.match(card, /\/api\/organization\/readiness/);
  assert.match(card, /requiredSteps\.filter\(\(step\) => step\.done\)/);
  assert.match(card, /Ready to recruit/);
  assert.match(card, /Open setup checklist/);
  assert.doesNotMatch(card, /notifications\/health/);
  assert.match(dashboard, /organizations\.onboardingStartedAt/);
  assert.match(metrics, /<GettingStarted/);
  assert.ok(metrics.indexOf("<GettingStarted organizationId=") < metrics.indexOf('className="dashboard-section dashboard-attention"'), "the onboarding checklist appears before the dashboard action queues");
  assert.match(metrics, /showGettingStarted/);
  assert.match(dashboard, /organizationId=\{user\.organizationId\}/);
  assert.match(lib, /jobPosted: count\("Job Posted"\)/);
  assert.doesNotMatch(dashboard, /approves, returns, rejects/);
});
