/**
 * Presentation labels for application stages.
 *
 * These labels are deliberately separate from workflow/database values.
 * Callers may use this helper when rendering a stage, but must continue to
 * send and persist the canonical status key.
 */
const APPLICANT_STAGE_LABELS: Record<string, string> = {
  resume_review: "Resume Review",
  resume_approved: "Resume Approved",
  voice_booking_pending: "Voice Booking Pending",
  voice_scheduled: "Voice Interview Scheduled",
  voice_review_pending: "Voice Interview Review",
  approved_for_final: "Approved for Face-to-Face Interview",
  final_scheduled: "Face-to-Face Interview Scheduled",
  final_decision_pending: "Face-to-Face Decision Pending",
  passed_final: "Passed Final Interview",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  // Normalize older display wording without changing the stored value.
  resume_hr_review: "Resume Review",
  voice_hr_review: "Voice Interview Review",
  passed_face_to_face_interview: "Passed Final Interview",
};

export function applicantStageLabel(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return "";
  const key = text.toLowerCase().replace(/[\s-]+/g, "_");
  return APPLICANT_STAGE_LABELS[key] || (text.includes("_")
    ? text.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())
    : text);
}

/**
 * Decision values are stored as workflow keys, but decisions are shown as
 * short action labels in the HR UI. Keep this separate from stage labels:
 * `approve` is a decision, while `resume_approved` is a workflow stage.
 */
export function applicantDecisionLabel(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return "";
  const key = text.toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "approve" || key === "approved") return "Approve";
  if (key === "reject" || key === "rejected") return "Reject";
  if (key === "manual_review" || key === "return_for_review" || key === "to_review") return "Return for review";
  if (key === "no_show") return "No Show";
  if (key === "pending") return "Pending";
  return text;
}
