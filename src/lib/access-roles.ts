/**
 * Small preset catalog for account administration.
 *
 * The accessRole value is a label, while the capability booleans are the
 * authorization source of truth. HR can start from a preset and then tune an
 * individual account. HR is the only access administrator; Admin is a
 * credits-only starting preset.
 */
export type AccessRolePermissions = {
  canCreateRole: boolean;
  canReviewRole: boolean;
  canApproveRole: boolean;
  canEditSettings: boolean;
  canManageUsers: boolean;
  canManageCredits: boolean;
  canReviewDepartmentRole: boolean;
};

export type AccessRoleOption = AccessRolePermissions & {
  value: string;
  label: string;
  description: string;
};

type AccessControlledUser = AccessRolePermissions & { accessRole: string };

/** Apply the two safety invariants to both legacy Sheet rows and Postgres rows.
 * Custom access remains explicitly capability-driven; named Admin and HR
 * presets cannot accidentally inherit an older, broader permission set. */
export function applyAccessRolePolicy<T extends AccessControlledUser>(user: T): T {
  const role = user.accessRole.trim().toLowerCase();
  if (role === "admin") {
    return {
      ...user,
      canCreateRole: false,
      canReviewRole: false,
      canApproveRole: false,
      canEditSettings: false,
      canManageUsers: false,
      canManageCredits: true,
      canReviewDepartmentRole: false,
    };
  }
  if (role === "hr") {
    return { ...user, canManageUsers: true };
  }
  return { ...user, canManageUsers: false };
}

export const ACCESS_ROLE_OPTIONS: AccessRoleOption[] = [
  {
    value: "HR",
    label: "HR",
    description: "Manage user access and the recruitment workflow.",
    canCreateRole: true,
    canReviewRole: true,
    canApproveRole: false,
    canEditSettings: false,
    canManageUsers: true,
    canManageCredits: false,
    canReviewDepartmentRole: false,
  },
  {
    value: "Admin",
    label: "Admin",
    description: "Manage Smile Credits only. HR controls this account's other access.",
    canCreateRole: false,
    canReviewRole: false,
    canApproveRole: false,
    canEditSettings: false,
    canManageUsers: false,
    canManageCredits: true,
    canReviewDepartmentRole: false,
  },
  {
    value: "Custom",
    label: "Custom access",
    description: "Start with no elevated access and select only the capabilities required.",
    canCreateRole: false,
    canReviewRole: false,
    canApproveRole: false,
    canEditSettings: false,
    canManageUsers: false,
    canManageCredits: false,
    canReviewDepartmentRole: false,
  },
];

export function getAccessRolePreset(value: string): AccessRoleOption | undefined {
  const normalized = value.trim().toLowerCase();
  return ACCESS_ROLE_OPTIONS.find((option) => option.value.toLowerCase() === normalized);
}
