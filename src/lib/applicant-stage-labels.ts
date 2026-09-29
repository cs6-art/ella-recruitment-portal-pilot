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
export const AVATAR_INTERVIEW_REVIEW_STATUS_LABEL = "Avatar Interview Review";
export const INTERVIEW_CHOICE_PENDING_LABEL = "Interview Choice Pending";
// Keep the historical export name for callers that need the workflow status.
export const AVATAR_INTERVIEW_REVIEW_LABEL = AVATAR_INTERVIEW_REVIEW_STATUS_LABEL;

const APPLICANT_STAGE_LABELS: Record<string, string> = {
  resume_review: "Resume Review",
  resume_approved: "Resume Approved",
  voice_booking_pending: "Live Avatar Interview Pending",
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
  avatar_interview_review: AVATAR_INTERVIEW_REVIEW_STATUS_LABEL,
  live_avatar_review: AVATAR_INTERVIEW_REVIEW_STATUS_LABEL,
  avatar_interview_booking_pending: "Live Avatar Interview Pending",
  avatar_interview_scheduled: "Live Avatar Interview Scheduled",
  passed_face_to_face_interview: "Passed Final Interview",
};

export function applicantStageLabel(value: string | null | undefined, mode: ApplicantInterviewMode = "avatar") {
  const text = String(value || "").trim();
  if (!text) return "";
  const key = text.toLowerCase().replace(/[\s-]+/g, "_");
  const raw = text.toLowerCase();
  const avatarReview = /(?:live\s+)?avatar\s+interview/.test(raw) && /review|completed|awaiting/.test(raw);
  const voiceReview = /voice\s+interview/.test(raw) && /review|completed|awaiting/.test(raw);
  if (avatarReview) return mode === "pending" ? "Interview Review" : AVATAR_INTERVIEW_REVIEW_STATUS_LABEL;
  if (voiceReview) return mode === "pending" ? "Interview Review" : VOICE_INTERVIEW_REVIEW_LABEL;
  if (/live\s+avatar\s+interview\s+in\s+progress/.test(raw)) return "Live Avatar Interview Pending";
  if (mode === "pending" && ["voice_booking_pending", "avatar_interview_booking_pending"].includes(key)) {
    return INTERVIEW_CHOICE_PENDING_LABEL;
  }
  if (mode === "pending" && ["voice_review_pending", "voice_hr_review", "voice_interview_review", "avatar_interview_review", "live_avatar_review"].includes(key)) {
    return "Interview Review";
  }
  if (["voice_review_pending", "voice_hr_review", "voice_interview_review", "avatar_interview_review", "live_avatar_review"].includes(key)) {
    return mode === "voice" ? VOICE_INTERVIEW_REVIEW_LABEL : AVATAR_INTERVIEW_REVIEW_STATUS_LABEL;
  }
  if (["voice_booking_pending", "avatar_interview_booking_pending"].includes(key)) {
    return mode === "voice" ? "Voice Interview Booking Pending" : "Live Avatar Interview Pending";
  }
  if (["voice_scheduled", "avatar_interview_scheduled"].includes(key)) {
    return mode === "voice" ? "Voice Interview Scheduled" : "Live Avatar Interview Scheduled";
  }
  // Always title-case the fallback, not just underscored keys -- a raw
  // single-word status like "scheduled" or "calling" must not reach the UI
  // in lowercase just because it has no underscore to split on.
  const label = APPLICANT_STAGE_LABELS[key] || text.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
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
  if (key === "manual_review" || key === "return_for_review" || key === "to_review") return "Return for Review";
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
  "internal_api": "System Update",
  "internal_api:booking": "Interview Booked",
  "internal_api:voice_booking_invitation": "Booking Invitation Queued",
  "internal_api:voice_result": "Live Avatar Interview Result Recorded",
  "internal_api:hr_decision": "Decision Recorded by HR",
  "portal_postgres_target": "System Update",
  "public-booking": "Candidate Booked Their Own Interview",
  "target:application": "Application Submitted",
  "hr interview status action": "Updated by HR",
  "automatic interview status monitor": "Automatic Status Update",
  "applicant review portal": "Updated in the Applicant Portal",
  "live_avatar": "Live Avatar Interview Completed",
};

/**
 * Who to show as having made a change. Automatic updates are recorded under
 * technical identifiers (a worker name, "system@…local"), which mean nothing to
 * users, so those show as an automatic update instead of a person.
 */
export function historyActorLabel(name: string | null | undefined, email: string | null | undefined): { automated: boolean; name: string; email: string } {
  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim();
  const technical = (value: string) => /^(system|pilot|internal|worker|automation|automatic|service|bot|n8n|cron|webhook)\b/i.test(value) || /(^|[-_:])(worker|system|bot|api)([-_:@.]|$)/i.test(value) || /\.local$/i.test(value);
  // A name with a space in it ("Sam Worker") is a person; technical names are single tokens.
  const technicalName = (value: string) => !/\s/.test(value) && technical(value);
  const emailIsPerson = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) && !technical(cleanEmail);
  const nameIsPerson = Boolean(cleanName) && !technicalName(cleanName);
  if (emailIsPerson || nameIsPerson) return { automated: false, name: nameIsPerson ? cleanName : "", email: emailIsPerson ? cleanEmail : "" };
  return { automated: Boolean(cleanName || cleanEmail), name: "", email: "" };
}

export function historySourceLabel(value: string | null | undefined, mode: ApplicantInterviewMode = "avatar") {
  const text = String(value || "").trim();
  if (!text) return "";
  const known = HISTORY_SOURCE_LABELS[text.toLowerCase()];
  if (known) {
    if (text.toLowerCase() === "internal_api:voice_result") {
      if (mode === "pending") return "Interview Result Recorded";
      if (mode === "voice") return "Voice Interview Result Recorded";
    }
    return known;
  }
  // Unrecognized value — still strip the technical punctuation instead of
  // showing a raw "internal_api:something" style token.
  return text.replace(/[_:-]+/g, " ").trim().replace(/\b\w/g, (character) => character.toUpperCase());
}
