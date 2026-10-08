import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("HR reviewers can change roles and permissions of other accounts, and the directory tells the editor so", () => {
  const route = read("src/app/api/user-directory/route.ts");
  assert.match(route, /const canEditPermissions = platformAdmin \|\| canAdministerAccess\(access\.user\);/);
  assert.match(route, /canEditPermissions, canManageTeam/);
  // the editor's permission choices are applied, not replaced by the stored values
  const block = route.slice(route.indexOf("if (!platformAdmin) {"), route.indexOf("if (!canManageTeam("));
  for (const field of ["accessRole", "canCreateRole", "canReviewRole", "canApproveRole", "canEditSettings", "canManageUsers", "canManageCredits", "canReviewDepartmentRole"]) {
    assert.match(block, new RegExp(`${field}: normalizedUser\\.${field}`), field);
  }
});

test("nobody can change their own role or permissions", () => {
  const route = read("src/app/api/user-directory/route.ts");
  assert.match(route, /if \(normalizedOriginalEmail === normalizedCurrentEmail && permissionsChanged\(user, current\)\) return responseError\("You cannot change your own role or permissions\. Ask another HR reviewer\.", 403\);/);
  assert.match(route, /const normalizedCurrentEmail = access\.user\.email\.trim\(\)\.toLowerCase\(\);/);
});

test("the permission check covers every role and permission field the editor can change", () => {
  const route = read("src/app/api/user-directory/route.ts");
  const helper = route.slice(route.indexOf("function permissionsChanged"), route.indexOf("async function saveAccount"));
  for (const field of ["accessRole", "canCreateRole", "canReviewRole", "canApproveRole", "canEditSettings", "canManageCredits", "canReviewDepartmentRole"]) {
    assert.match(helper, new RegExp(`input\\.${field}`), field);
  }
  assert.doesNotMatch(helper, /input\.active|input\.department/);
});

test("ownership transfer stays with platform administrators", () => {
  const route = read("src/app/api/user-directory/route.ts");
  assert.match(route, /if \(platformAdmin && user\.isOrganizationOwner === true && !isDefaultOrganization\)/);
  const editor = read("src/components/UserAccountsEditor.tsx");
  assert.match(editor, /disabled=\{!canManageOrganizations\} checked=\{form\.isOrganizationOwner === true\}/);
});

test("the editor locks permission controls only for self-edits or accounts without HR access, and explains why", () => {
  const editor = read("src/components/UserAccountsEditor.tsx");
  assert.match(editor, /setCanEditPermissions\(data\.canEditPermissions === true\)/);
  assert.match(editor, /const editingOwnAccount = Boolean\(originalEmail\) && originalEmail\.trim\(\)\.toLowerCase\(\) === currentEmail\.trim\(\)\.toLowerCase\(\);/);
  assert.match(editor, /const permissionsLocked = !canEditPermissions \|\| editingOwnAccount;/);
  for (const field of ["canCreateRole", "canReviewRole", "canReviewDepartmentRole", "canApproveRole", "canManageCredits", "canEditSettings"]) {
    assert.match(editor, new RegExp(`disabled=\\{permissionsLocked\\} checked=\\{form\\.${field}\\}`), field);
  }
  assert.match(editor, /<select id="user-access-role" disabled=\{permissionsLocked\}/);
  assert.match(editor, /You cannot change your own role or permissions\. Ask another HR reviewer\./);
  // Account is active stays editable so HR can still deactivate people
  assert.match(editor, /<input type="checkbox" checked=\{form\.active\}/);
});
