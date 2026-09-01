import assert from "node:assert/strict";
import test from "node:test";

import {
  canDecideApplicant,
  canDeleteApplicant,
  canDeleteRoleRequest,
  canEditApplicant,
  canEditRecruitmentSetup,
  canEditRoleRequest,
  canManagePipeline,
  canViewApplicant,
  canViewRole,
  canViewRoleList,
  filterVisibleApplicants,
  filterVisibleRoles,
  isDepartmentReviewer,
} from "../src/lib/access-control.ts";

function user(overrides = {}) {
  return {
    email: "user@mclinkgroup.com",
    department: "IT",
    canCreateRole: false,
    canReviewRole: false,
    canApproveRole: false,
    canReviewDepartmentRole: false,
    ...overrides,
  };
}

const hod = user({ canCreateRole: true, canReviewDepartmentRole: true, department: "IT" });
const hr = user({ canCreateRole: true, canReviewRole: true, department: "HR" });
const management = user({ canApproveRole: true, department: "Management" });
const requester = user({ canCreateRole: true, department: "Sales" });

const roleInDept = { requesterEmail: "someone-else@mclinkgroup.com", department: "IT", status: "Pending HR Discussion" };
const roleOutsideDept = { requesterEmail: "someone-else@mclinkgroup.com", department: "Finance", status: "Pending HR Discussion" };
const ownRole = { requesterEmail: "user@mclinkgroup.com", department: "Sales", status: "Pending HR Discussion" };

test("HOD sees and can act on their own draft, but only views their own department's other roles", () => {
  assert.equal(canViewRoleList(hod), true);
  assert.equal(canViewRole(hod, roleInDept), true);
  assert.equal(canViewRole(hod, roleOutsideDept), false);
  // View-only: no edit/delete rights over someone else's role, even in their department.
  assert.equal(canEditRoleRequest(hod, roleInDept), false);
  assert.equal(canDeleteRoleRequest(hod, roleInDept), false);
  // But they can still edit/delete their own request, same as any requester.
  assert.equal(canEditRoleRequest(hod, ownRole), true);
});

test("isDepartmentReviewer only classifies the HOD tier, not HR/Management", () => {
  assert.equal(isDepartmentReviewer(hod), true);
  assert.equal(isDepartmentReviewer(hr), false);
  assert.equal(isDepartmentReviewer(management), false);
});

test("Management is view-only: no recruitment setup, pipeline management, applicant decisions, or edit/delete rights", () => {
  assert.equal(canEditRecruitmentSetup(management), false);
  assert.equal(canManagePipeline(management), false);
  assert.equal(canEditApplicant(management), false);
  assert.equal(canDeleteApplicant(management), false);
  assert.equal(canEditRoleRequest(management, roleInDept), false);
  // Management holds no applicant hiring-decision rights — that is the HR tier.
  assert.equal(canDecideApplicant(management), false);
  // They retain company-wide read visibility.
  assert.equal(canViewRole(management, roleOutsideDept), true);
  assert.equal(canViewApplicant(management, { department: "Finance" }), true);
});

test("HR retains full company-wide pipeline management", () => {
  assert.equal(canEditRecruitmentSetup(hr), true);
  assert.equal(canEditApplicant(hr), true);
  assert.equal(canDeleteApplicant(hr), true);
  assert.equal(canEditRoleRequest(hr, roleOutsideDept), true);
  assert.equal(canViewRole(hr, roleOutsideDept), true);
  assert.equal(canDecideApplicant(hr), true);
});

test("a plain requester cannot view roles outside their own", () => {
  assert.equal(canViewRole(requester, roleOutsideDept), false);
  assert.equal(canViewRole(requester, ownRole), true);
});

test("filterVisibleRoles scopes HOD to their department, HR/Management to everything, requester to their own", () => {
  const roles = [roleInDept, roleOutsideDept, ownRole];
  assert.deepEqual(filterVisibleRoles(roles, hod), [roleInDept]);
  assert.deepEqual(filterVisibleRoles(roles, hr), roles);
  assert.deepEqual(filterVisibleRoles(roles, management), roles);
  assert.deepEqual(filterVisibleRoles(roles, requester), [ownRole]);
});

test("filterVisibleApplicants and canViewApplicant apply the same department scoping", () => {
  const applicants = [{ department: "IT", id: 1 }, { department: "Finance", id: 2 }];
  assert.deepEqual(filterVisibleApplicants(applicants, hod), [{ department: "IT", id: 1 }]);
  assert.deepEqual(filterVisibleApplicants(applicants, hr), applicants);
  assert.deepEqual(filterVisibleApplicants(applicants, management), applicants);
  assert.deepEqual(filterVisibleApplicants(applicants, requester), []);
  assert.equal(canViewApplicant(hod, { department: "IT" }), true);
  assert.equal(canViewApplicant(hod, { department: "Finance" }), false);
});
