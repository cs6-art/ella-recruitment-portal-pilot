/**
 * Recruitment access-role catalog used by account administration. The
 * permissions remain independently editable because a department may need a
 * small variation from the recommended default for that role.
 */
export type AccessRolePermissions = {
  canCreateRole: boolean;
  canReviewRole: boolean;
  canApproveRole: boolean;
  canEditSettings: boolean;
  canManageUsers: boolean;
  // HOD-tier: view (not edit) roles, candidates, and interviews limited to
  // the holder's own department. Distinct from canReviewRole, which grants
  // company-wide pipeline management (recruitment setup, applicants,
  // bookings). See src/lib/access-control.ts for the enforcement.
  canReviewDepartmentRole: boolean;
};

export type AccessRoleOption = AccessRolePermissions & {
  value: string;
  label: string;
  description: string;
};

export const ACCESS_ROLE_OPTIONS: AccessRoleOption[] = [
  {
    value: "CEO",
    label: "CEO",
    description: "Full access to users, settings, credits, and all recruitment workflows.",
    canCreateRole: true,
    canReviewRole: true,
    canApproveRole: true,
    canEditSettings: true,
    canManageUsers: true,
    canReviewDepartmentRole: true,
  },
  {
    value: "Admin",
    label: "Admin",
    description: "Manage users, portal settings, and all recruitment workflows.",
    canCreateRole: true,
    canReviewRole: true,
    canApproveRole: true,
    canEditSettings: true,
    canManageUsers: true,
    canReviewDepartmentRole: true,
  },
  {
    value: "HR",
    label: "HR",
    description: "Create and review role requests, candidates, and interviews.",
    canCreateRole: true,
    canReviewRole: true,
    canApproveRole: false,
    canEditSettings: false,
    canManageUsers: false,
    canReviewDepartmentRole: false,
  },
  {
    value: "Management",
    label: "Management",
    description: "Review role requests and candidates, and approve, reject, or return them as the management decision-maker. Does not edit recruitment setup, applicant records, or interview scheduling.",
    canCreateRole: false,
    canReviewRole: false,
    canApproveRole: true,
    canEditSettings: false,
    canManageUsers: false,
    canReviewDepartmentRole: false,
  },
  {
    value: "HOD",
    label: "HOD / Department Head",
    description: "Create role requests and view hiring activity for your own department. Read-only for roles and candidates; does not edit recruitment setup, applicant records, or other departments' work.",
    canCreateRole: true,
    canReviewRole: false,
    canApproveRole: false,
    canEditSettings: false,
    canManageUsers: false,
    canReviewDepartmentRole: true,
  },
  {
    value: "Recruiter",
    label: "Recruiter",
    description: "Manage candidate screening, interviews, and recruitment activity.",
    canCreateRole: true,
    canReviewRole: true,
    canApproveRole: false,
    canEditSettings: false,
    canManageUsers: false,
    canReviewDepartmentRole: false,
  },
  {
    value: "Interviewer",
    label: "Interviewer",
    description: "Review candidates and conduct assigned interviews.",
    canCreateRole: false,
    canReviewRole: true,
    canApproveRole: false,
    canEditSettings: false,
    canManageUsers: false,
    canReviewDepartmentRole: false,
  },
  {
    value: "Hiring Manager",
    label: "Hiring Manager",
    description: "Review role requirements and make hiring approvals.",
    canCreateRole: false,
    canReviewRole: true,
    canApproveRole: true,
    canEditSettings: false,
    canManageUsers: false,
    canReviewDepartmentRole: false,
  },
  {
    value: "Finance Reviewer",
    label: "Finance Reviewer",
    description: "Read recruitment information for budget and salary review.",
    canCreateRole: false,
    canReviewRole: false,
    canApproveRole: false,
    canEditSettings: false,
    canManageUsers: false,
    canReviewDepartmentRole: false,
  },
  {
    value: "Auditor",
    label: "Auditor / Read-only",
    description: "View permitted records without changing recruitment data.",
    canCreateRole: false,
    canReviewRole: false,
    canApproveRole: false,
    canEditSettings: false,
    canManageUsers: false,
    canReviewDepartmentRole: false,
  },
  {
    value: "Requester",
    label: "Requester / Employee",
    description: "Submit and track the requester’s own role requests.",
    canCreateRole: true,
    canReviewRole: false,
    canApproveRole: false,
    canEditSettings: false,
    canManageUsers: false,
    canReviewDepartmentRole: false,
  },
];

export function getAccessRolePreset(value: string): AccessRoleOption | undefined {
  const normalized = value.trim().toLowerCase();
  return ACCESS_ROLE_OPTIONS.find((option) => option.value.toLowerCase() === normalized);
}
