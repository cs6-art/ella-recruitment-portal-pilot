import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const route = fs.readFileSync("src/app/api/user-directory/route.ts", "utf8");
const editor = fs.readFileSync("src/components/UserAccountsEditor.tsx", "utf8");

test("registration reset is an admin-only credential reset, not directory deletion", () => {
  assert.match(route, /export async function DELETE/);
  assert.match(route, /isPlatformAdmin\(access\.user\)/);
  assert.match(route, /delete\(userCredentials\)/);
  assert.match(route, /syncOrganizationMembership\(\{ organizationId: target\.organizationId, email, active: false \}\)/);
  assert.match(route, /The user can register again/);
  assert.doesNotMatch(route, /delete\(users\)/);
});

test("the directory exposes reset registration with an explicit confirmation", () => {
  assert.match(editor, /Reset registration\?/);
  assert.match(editor, /method: "DELETE"/);
  assert.match(editor, /directory access and history will be preserved/);
});
