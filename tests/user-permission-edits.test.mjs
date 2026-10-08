import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("a non-platform-administrator's permission edit is refused, not reported as saved", () => {
  const route = read("src/app/api/user-directory/route.ts");
  assert.match(route, /function permissionsChanged\(input: z\.infer<typeof userSchema>, current: DirectoryUser\)/);
  assert.match(route, /if \(permissionsChanged\(user, current\)\) return responseError\("Only a McLink platform administrator can change roles and permissions\. Nothing was saved\.", 403\);/);
  // the refusal must come before the existing values are copied over the edit
  const refusal = route.indexOf("if (permissionsChanged(user, current))");
  const copy = route.indexOf("Object.assign(normalizedUser, current,");
  assert.ok(refusal > 0 && copy > refusal, "refusal must run before Object.assign");
});

test("the permission check covers every role and permission field the editor can change", () => {
  const route = read("src/app/api/user-directory/route.ts");
  const helper = route.slice(route.indexOf("function permissionsChanged"), route.indexOf("async function saveAccount"));
  for (const field of ["accessRole", "canCreateRole", "canReviewRole", "canApproveRole", "canEditSettings", "canManageCredits", "canReviewDepartmentRole"]) {
    assert.match(helper, new RegExp(`input\\.${field}`), field);
  }
  // active and department stay editable by HR
  assert.doesNotMatch(helper, /input\.active|input\.department/);
});

test("the editor locks role and permission controls for non-administrators and says why", () => {
  const editor = read("src/components/UserAccountsEditor.tsx");
  for (const field of ["canCreateRole", "canReviewRole", "canReviewDepartmentRole", "canApproveRole", "canManageCredits", "canEditSettings"]) {
    assert.match(editor, new RegExp(`disabled=\\{!canManageOrganizations\\} checked=\\{form\\.${field}\\}`), field);
  }
  assert.match(editor, /<select id="user-access-role" disabled=\{!canManageOrganizations\}/);
  assert.match(editor, /Only a McLink platform administrator can change roles and permissions/);
  // Account is active stays editable so HR can still deactivate people
  assert.match(editor, /<input type="checkbox" checked=\{form\.active\}/);
});
