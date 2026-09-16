import assert from "node:assert/strict";
import test from "node:test";

import { canManageCredits } from "../src/lib/access-control.ts";
import { applyAccessRolePolicy, getAccessRolePreset } from "../src/lib/access-roles.ts";

const perms = (value) => {
  const preset = getAccessRolePreset(value);
  assert.ok(preset, `missing preset ${value}`);
  return { canManageCredits: preset.canManageCredits };
};

test("canManageCredits is an explicit capability", () => {
  assert.equal(canManageCredits(perms("Admin")), true);
  for (const role of ["HR", "Custom"]) {
    assert.equal(canManageCredits(perms(role)), false, `${role} must not manage credits`);
  }
});

test("canManageCredits ignores display role and unrelated capabilities", () => {
  assert.equal(canManageCredits({ accessRole: "Admin", canEditSettings: true, canReviewRole: true, canManageCredits: false }), false);
  assert.equal(canManageCredits({ accessRole: "Custom", canManageCredits: true }), true);
});

test("Admin is the credits-only starting preset", () => {
  assert.equal(getAccessRolePreset("Admin")?.label, "Admin");
  assert.equal(getAccessRolePreset("Admin")?.canManageCredits, true);
  assert.equal(getAccessRolePreset("Admin")?.canReviewRole, false);
  assert.equal(getAccessRolePreset("Admin")?.canManageUsers, false);
});

test("legacy Admin flags are normalized to credits-only", () => {
  const effective = applyAccessRolePolicy({
    accessRole: "Admin",
    canCreateRole: true,
    canReviewRole: true,
    canApproveRole: true,
    canEditSettings: true,
    canManageUsers: true,
    canManageCredits: false,
    canReviewDepartmentRole: true,
  });
  assert.deepEqual(effective, {
    accessRole: "Admin",
    canCreateRole: false,
    canReviewRole: false,
    canApproveRole: false,
    canEditSettings: false,
    canManageUsers: false,
    canManageCredits: true,
    canReviewDepartmentRole: false,
  });
});
