export const STATUS_ACTION_LABELS: Record<string, string> = {
  approve_role: "Approve Role",
  reject_role: "Reject Role",
  return_for_revision_hr: "Return for Revision",
  place_on_hold_hr: "Place on Hold",
  resume_hr_review: "Resume HR Review",
  role_request_created: "Role Request Created",
  // Retired with the Management-approval step; kept so historical timeline
  // entries created before the change still render a readable label.
  send_for_management_approval: "Sent for Management Approval",
  return_for_revision_management: "Returned for Revision by Management",
  place_on_hold_management: "Placed on Hold by Management",
  resume_management_approval: "Resumed Management Approval",
};

export function getStatusActionLabel(action: string): string {
  return STATUS_ACTION_LABELS[action] || action;
}
