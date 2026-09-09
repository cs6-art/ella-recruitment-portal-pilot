import { applicantStageLabel } from "@/lib/applicant-stage-labels";

/**
 * Human-readable copy for the recruitment notification queue. The stored
 * `notificationEventType` and workflow stage keys are canonical values; these
 * helpers turn them into the wording used in HR and candidate emails so the
 * n8n notifier never has to render raw keys such as `voice_result_next_step`.
 */
const EVENT_LABELS: Record<string, string> = {
  application_acknowledgment: "Application received",
  application_stage_update: "Application status update",
  screening_next_step: "CV screening completed",
  voice_booking_invitation: "AI voice interview — booking invitation",
  voice_booking_confirmation: "AI voice interview — booking confirmed",
  voice_result_next_step: "AI voice interview completed — HR review needed",
  voice_no_show: "AI voice interview — candidate did not attend",
  voice_retry: "AI voice interview — call retry scheduled",
  voice_rejection: "AI voice interview — candidate not shortlisted",
  final_booking_invitation: "Face-to-face interview — booking invitation",
  final_booking_confirmation: "Face-to-face interview — booking confirmed",
  final_decision_pass: "Face-to-face interview — candidate passed",
  final_decision_reject: "Face-to-face interview — candidate not selected",
};

const EVENT_SUMMARIES: Record<string, string> = {
  application_acknowledgment: "The candidate's application has been received and is now in the review queue.",
  screening_next_step: "CV screening is complete. Review the recommendation and decide whether to move the candidate forward.",
  voice_booking_invitation: "The candidate has been invited to book their AI voice interview.",
  voice_booking_confirmation: "The candidate has booked their AI voice interview.",
  voice_result_next_step: "The AI voice interview is complete. Open the applicant record to review the transcript and evaluation, then approve or decline the candidate for the face-to-face interview.",
  voice_no_show: "The candidate did not attend the scheduled AI voice interview. Open the applicant record to reschedule or decline.",
  voice_retry: "The AI voice interview call did not connect. A retry has been scheduled automatically.",
  voice_rejection: "The candidate was not shortlisted after the AI voice interview.",
  final_booking_invitation: "The candidate has been invited to book their face-to-face interview.",
  final_booking_confirmation: "The candidate has booked their face-to-face interview.",
  final_decision_pass: "The candidate passed the face-to-face interview.",
  final_decision_reject: "The candidate was not selected after the face-to-face interview.",
};

function normalize(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

/** Email-ready name for a notification event, e.g. "AI voice interview completed — HR review needed". */
export function notificationEventLabel(eventType: string | null | undefined) {
  const key = normalize(eventType);
  return EVENT_LABELS[key] || (key ? titleCase(key) : "Recruitment update");
}

/** Email-ready name for the applicant's workflow stage, e.g. "Voice Interview Review". */
export function notificationStatusLabel(stage: string | null | undefined) {
  return applicantStageLabel(stage) || "";
}

/** A sentence describing the update. Falls back to the reviewer's comment, then a generic line. */
export function notificationSummary(eventType: string | null | undefined, comments?: string | null) {
  const trimmed = String(comments || "").trim();
  if (trimmed) return trimmed;
  return EVENT_SUMMARIES[normalize(eventType)] || "A recruitment workflow update requires your attention.";
}
