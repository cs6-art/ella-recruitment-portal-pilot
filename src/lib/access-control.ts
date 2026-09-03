import type { RoleRequestDetails, RoleRequestSummary } from "@/lib/google-sheets";
import type { SessionUser } from "@/lib/session";

// Three distinct tiers share this module:
// - canReviewRole: HR/Admin. Company-wide pipeline management — recruitment
//   setup, applicant records, interview scheduling — plus HR-stage review.
// - canApproveRole: Management/Admin. Company-wide visibility, but limited to
//   reviewing and approving/rejecting/returning role requests and hiring
//   decisions. Does not edit recruitment setup, applicant records, or
//   bookings (see canEditApplicant, canEditRecruitmentSetup, bookings routes).
// - canReviewDepartmentRole: HOD/Admin. Read-only visibility (plus interview
//   participation) limited to the holder's own department. No edit, delete,
//   or decision rights anywhere in the pipeline.
function sameDepartment(user: Pick<SessionUser, "department">, department: string): boolean {
  const userDepartment = user.department.trim().toLowerCase();
  return Boolean(userDepartment) && userDepartment === department.trim().toLowerCase();
}

export function canViewRoleList(user: SessionUser): boolean {
  return user.canReviewRole === true || user.canApproveRole === true || user.canCreateRole === true || user.canReviewDepartmentRole === true;
}

export function isCreatorOnly(user: SessionUser): boolean {
  return user.canCreateRole === true && user.canReviewRole !== true && user.canApproveRole !== true && user.canReviewDepartmentRole !== true;
}

export function isDepartmentReviewer(user: Pick<SessionUser, "canReviewRole" | "canApproveRole" | "canReviewDepartmentRole">): boolean {
  return user.canReviewDepartmentRole === true && user.canReviewRole !== true && user.canApproveRole !== true;
}

export function canViewRole(user: SessionUser, role: Pick<RoleRequestDetails, "requesterEmail" | "department">): boolean {
  if (user.canReviewRole === true || user.canApproveRole === true) return true;
  if (isDepartmentReviewer(user)) return sameDepartment(user, role.department);
  return isCreatorOnly(user) && role.requesterEmail.trim().toLowerCase() === user.email.trim().toLowerCase();
}

export function filterVisibleRoles<T extends Pick<RoleRequestSummary, "requesterEmail" | "department">>(roles: T[], user: SessionUser): T[] {
  if (user.canReviewRole === true || user.canApproveRole === true) return roles;
  if (isDepartmentReviewer(user)) return roles.filter((role) => sameDepartment(user, role.department));
  if (!isCreatorOnly(user)) return [];
  const email = user.email.trim().toLowerCase();
  return roles.filter((role) => role.requesterEmail.trim().toLowerCase() === email);
}

// Company-wide pipeline management (recruitment setup, applicant records,
// bookings/interview scheduling, resume-screening invites). Management is
// deliberately excluded — their tier is decision-only (approve/reject role
// requests and hiring outcomes), not operational editing.
export function canManagePipeline(user: Pick<SessionUser, "canReviewRole">): boolean {
  return user.canReviewRole === true;
}

export function canEditRecruitmentSetup(user: SessionUser): boolean {
  return canManagePipeline(user);
}

export function canEditHodAvailability(user: Pick<SessionUser, "email" | "canReviewRole">, role: Pick<RoleRequestDetails, "hodEmail" | "requesterEmail">): boolean {
  if (user.canReviewRole === true) return true;
  const email = user.email.trim().toLowerCase();
  return [role.hodEmail, role.requesterEmail].some((value) => value.trim().toLowerCase() === email);
}

export function canEditRoleRequest(
  user: Pick<SessionUser, "email" | "canReviewRole">,
  role: Pick<RoleRequestDetails, "requesterEmail" | "status">,
): boolean {
  // Role-request content edits remain available after approval, setup,
  // publication, or rejection so HR can correct or remove records from any
  // workflow stage. Visibility and ownership still control who may perform
  // the action. Management (canApproveRole) is intentionally excluded here —
  // their tier decides via status transitions, it does not edit content.
  if (user.canReviewRole === true) return true;
  return role.requesterEmail.trim().toLowerCase() === user.email.trim().toLowerCase();
}

export function canDeleteRoleRequest(
  user: Pick<SessionUser, "email" | "canReviewRole">,
  role: Pick<RoleRequestDetails, "requesterEmail" | "status">,
): boolean {
  return canEditRoleRequest(user, role);
}

// Editing/deleting applicant records is company-wide HR pipeline management.
// Management (decision-only) and HOD (department read-only) do not qualify —
// Management still decides outcomes via /applicants/[id]/decision.
export function canEditApplicant(user: Pick<SessionUser, "canReviewRole">): boolean {
  return canManagePipeline(user);
}

export function canDeleteApplicant(user: Pick<SessionUser, "canReviewRole">): boolean {
  return canEditApplicant(user);
}

// Approving, rejecting, or returning an applicant at any pipeline stage
// (resume, voice, final) is a company-wide pipeline decision reserved for the
// HR tier. Management (canApproveRole) is view-only everywhere in the
// pipeline — the Management-approval step was removed and Management holds no
// applicant hiring-decision rights.
export function canDecideApplicant(user: Pick<SessionUser, "canReviewRole">): boolean {
  return user.canReviewRole === true;
}

export function canViewApplicant(user: SessionUser, applicant: { department: string }): boolean {
  if (user.canReviewRole === true || user.canApproveRole === true) return true;
  if (isDepartmentReviewer(user)) return sameDepartment(user, applicant.department);
  return false;
}

export function filterVisibleApplicants<T extends { department: string }>(applicants: T[], user: SessionUser): T[] {
  if (user.canReviewRole === true || user.canApproveRole === true) return applicants;
  if (isDepartmentReviewer(user)) return applicants.filter((applicant) => sameDepartment(user, applicant.department));
  return [];
}

// Ella Credits — viewing the ledger, manual/demo top-ups, and initiating a
// paid (HitPay) purchase. This is deliberately narrower than the recruitment
// reviewer capability: Admin requires the Admin preset plus settings access;
// HR requires the HR preset plus review access. Recruiter, Interviewer, Hiring
// Manager, Management, HOD, and requesters do not qualify. There is no separate
// IT Admin preset; Admin is the administrative path for this pilot.
export function canManageCredits(
  user: Pick<SessionUser, "accessRole" | "canEditSettings" | "canReviewRole">,
): boolean {
  const role = user.accessRole.trim().toLowerCase();
  if (role === "admin") return user.canEditSettings === true;
  return role === "hr" && user.canReviewRole === true;
}

export function canUseRecruitmentSetup(status: string): boolean {
  return ["Approved", "Recruitment Setup", "Job Posted"].includes(status.trim());
}

export function canManageInterviewAvailability(status: string): boolean {
  return ["Approved", "Recruitment Setup", "Job Posted"].includes(status.trim());
}
