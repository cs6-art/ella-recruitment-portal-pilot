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
