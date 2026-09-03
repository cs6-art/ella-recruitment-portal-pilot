import assert from "node:assert/strict";
import test from "node:test";

import { canManageCredits } from "../src/lib/access-control.ts";
import { getAccessRolePreset } from "../src/lib/access-roles.ts";

const perms = (value) => {
  const preset = getAccessRolePreset(value);
  assert.ok(preset, `missing preset ${value}`);
  return { accessRole: preset.value, canEditSettings: preset.canEditSettings, canReviewRole: preset.canReviewRole };
};

test("canManageCredits: only the Admin and HR paths may manage credits", () => {
  assert.equal(canManageCredits(perms("Admin")), true);
  assert.equal(canManageCredits(perms("HR")), true);
  for (const role of ["Recruiter", "Interviewer", "Hiring Manager", "Management", "HOD", "Requester", "Finance Reviewer", "Auditor"]) {
    assert.equal(canManageCredits(perms(role)), false, `${role} must not manage credits`);
  }
});

test("canManageCredits does not use broad capability flags alone", () => {
  assert.equal(canManageCredits({ accessRole: "Management", canEditSettings: true, canReviewRole: false }), false);
  assert.equal(canManageCredits({ accessRole: "HR", canEditSettings: false, canReviewRole: false }), false);
  assert.equal(canManageCredits({ accessRole: "Recruiter", canEditSettings: false, canReviewRole: true }), false);
  assert.equal(canManageCredits({ accessRole: "Admin", canEditSettings: true, canReviewRole: false }), true);
  assert.equal(canManageCredits({ accessRole: "HR", canEditSettings: false, canReviewRole: true }), true);
});

test("the pilot has no separate IT Admin preset; Admin is the admin path", () => {
  assert.equal(getAccessRolePreset("IT Admin"), undefined);
  assert.equal(getAccessRolePreset("Admin")?.label, "Admin");
});
