/**
 * Presentation labels for application stages.
 *
 * These labels are deliberately separate from workflow/database values.
 * Callers may use this helper when rendering a stage, but must continue to
 * send and persist the canonical status key.
 */
export type ApplicantInterviewMode = "avatar" | "voice" | "pending";

export const LIVE_AVATAR_REVIEW_LABEL = "Live Avatar Review";
export const VOICE_INTERVIEW_REVIEW_LABEL = "Voice Interview Review";
export const INTERVIEW_CHOICE_PENDING_LABEL = "Interview Choice Pending";
// Keep the historical export name for existing callers; its client-facing
// wording now explicitly identifies the Live Avatar review route.
export const AVATAR_INTERVIEW_REVIEW_LABEL = LIVE_AVATAR_REVIEW_LABEL;

const APPLICANT_STAGE_LABELS: Record<string, string> = {
  resume_review: "Resume Review",
  resume_approved: "Resume Approved",
  voice_booking_pending: "Live Avatar Interview In Progress",
  voice_scheduled: "Live Avatar Interview Scheduled",
  voice_review_pending: AVATAR_INTERVIEW_REVIEW_LABEL,
  approved_for_final: "Approved for Face-to-Face Interview",
  final_scheduled: "Face-to-Face Interview Scheduled",
  final_decision_pending: "Face-to-Face Decision Pending",
  passed_final: "Passed Final Interview",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  // Normalize older display wording without changing the stored value.
  resume_hr_review: "Resume Review",
  voice_hr_review: AVATAR_INTERVIEW_REVIEW_LABEL,
  voice_interview_review: VOICE_INTERVIEW_REVIEW_LABEL,
  avatar_interview_review: LIVE_AVATAR_REVIEW_LABEL,
  live_avatar_review: LIVE_AVATAR_REVIEW_LABEL,
  avatar_interview_booking_pending: "Live Avatar Interview In Progress",
  avatar_interview_scheduled: "Live Avatar Interview Scheduled",
  passed_face_to_face_interview: "Passed Final Interview",
};

export function applicantStageLabel(value: string | null | undefined, mode: ApplicantInterviewMode = "avatar") {
  const text = String(value || "").trim();
  if (!text) return "";
  const key = text.toLowerCase().replace(/[\s-]+/g, "_");
  if (mode === "pending" && ["voice_booking_pending", "avatar_interview_booking_pending"].includes(key)) {
    return INTERVIEW_CHOICE_PENDING_LABEL;
  }
  if (mode === "pending" && ["voice_review_pending", "voice_hr_review", "voice_interview_review", "avatar_interview_review", "live_avatar_review"].includes(key)) {
    return "Interview Review";
  }
  if (["voice_review_pending", "voice_hr_review", "voice_interview_review", "avatar_interview_review", "live_avatar_review"].includes(key)) {
    return mode === "voice" ? VOICE_INTERVIEW_REVIEW_LABEL : LIVE_AVATAR_REVIEW_LABEL;
  }
  if (["voice_booking_pending", "avatar_interview_booking_pending"].includes(key)) {
    return mode === "voice" ? "Voice Interview Booking Pending" : "Live Avatar Interview In Progress";
  }
  if (["voice_scheduled", "avatar_interview_scheduled"].includes(key)) {
    return mode === "voice" ? "Voice Interview Scheduled" : "Live Avatar Interview Scheduled";
  }
  const label = APPLICANT_STAGE_LABELS[key] || (text.includes("_")
    ? text.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())
    : text);
  return mode === "voice"
    ? label.replace(/\bLive Avatar Interview\b/g, "Voice Interview").replace(/\bAvatar Interview\b/g, "Voice Interview").replace(/\bLive Avatar\b/g, "Voice").replace(/\bAvatar\b/g, "Voice")
    : label;
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

/**
 * Which part of the hiring workflow a status history entry belongs to,
 * phrased for HR/client readers rather than the internal `resume`/`voice`/
 * `final` stage keys those entries are stored under.
 */
const HISTORY_STAGE_LABELS: Record<string, string> = {
  resume: "Resume Screening",
  voice: "Live Avatar Interview",
  final: "Face-to-Face Interview",
};

export function historyStageLabel(value: string | null | undefined, mode: ApplicantInterviewMode = "avatar") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (mode === "pending" && text.toLowerCase() === "voice") return "Interview";
  const label = HISTORY_STAGE_LABELS[text.toLowerCase()] || applicantStageLabel(text, mode);
  return mode === "voice" && label === "Live Avatar Interview" ? "Voice Interview" : label;
}

/**
 * Status history rows record where an update came from (an internal API
 * call, an automatic monitor, a public booking link, and so on) using
 * developer-facing identifiers such as "internal_api:voice_result" or
 * "target:application". HR and clients should never see those raw tokens —
 * translate the ones the system produces and fall back to a de-symboled,
 * title-cased reading of anything unrecognized (new sources included).
 */
const HISTORY_SOURCE_LABELS: Record<string, string> = {
  "internal_api": "System update",
  "internal_api:booking": "Interview booked",
  "internal_api:voice_booking_invitation": "Booking invitation queued",
  "internal_api:voice_result": "Live Avatar interview result recorded",
  "internal_api:hr_decision": "Decision recorded by HR",
  "portal_postgres_target": "System update",
  "public-booking": "Candidate booked their own interview",
  "target:application": "Application submitted",
  "hr interview status action": "Updated by HR",
  "automatic interview status monitor": "Automatic status update",
  "applicant review portal": "Updated in the applicant portal",
  "live_avatar": "Live Avatar interview completed",
};

export function historySourceLabel(value: string | null | undefined, mode: ApplicantInterviewMode = "avatar") {
  const text = String(value || "").trim();
  if (!text) return "";
  const known = HISTORY_SOURCE_LABELS[text.toLowerCase()];
  if (known) {
    if (text.toLowerCase() === "internal_api:voice_result") {
      if (mode === "pending") return "Interview result recorded";
      if (mode === "voice") return "Voice interview result recorded";
    }
    return known;
  }
  // Unrecognized value — still strip the technical punctuation instead of
  // showing a raw "internal_api:something" style token.
  return text.replace(/[_:-]+/g, " ").trim().replace(/\b\w/g, (character) => character.toUpperCase());
}
