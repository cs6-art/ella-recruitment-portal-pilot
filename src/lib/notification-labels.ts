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

const SIGNOFF = "Best regards,\nMcLink Group Recruitment Team";

const EMAIL_SUBJECTS: Record<string, string> = {
  voice_booking_invitation: "Schedule your AI voice interview with McLink Group",
  voice_booking_confirmation: "Your AI voice interview is confirmed",
  final_booking_invitation: "Next step: schedule your final interview with McLink Group",
  voice_result_next_step: "Your McLink Group application — next steps",
  voice_no_show: "Your missed AI voice interview with McLink Group",
  voice_retry: "We will call you again for your AI voice interview",
  voice_rejection: "Update on your McLink Group application",
  screening_next_step: "Your McLink Group application has been reviewed",
  application_acknowledgment: "We have received your McLink Group application",
};

export type NotificationEmailContext = {
  candidateName?: string | null;
  roleTitle?: string | null;
  bookingLink?: string | null;
  /** Human date/time already formatted with its timezone, for confirmations. */
  scheduledLabel?: string | null;
};

export type NotificationEmailCopy = {
  subject: string;
  heading: string;
  message: string;
  cta: string;
  ctaLink: string;
  signoff: string;
};

/**
 * Candidate-facing email copy for a notification event. The n8n notifier
 * renders these fields directly so wording lives with the workflow, not in a
 * separate template. Returns `null` for events that must not send an email
 * (e.g. the face-to-face booking confirmation, which Google Calendar covers).
 */
export function notificationEmail(eventType: string | null | undefined, context: NotificationEmailContext = {}): NotificationEmailCopy | null {
  const key = normalize(eventType);
  if (key === "final_booking_confirmation") return null;

  const name = String(context.candidateName || "").trim() || "there";
  const role = String(context.roleTitle || "").trim();
  const rolePhrase = role ? `the ${role} position` : "this position";
  const link = String(context.bookingLink || "").trim();
  const scheduled = String(context.scheduledLabel || "").trim();

  const base = { subject: EMAIL_SUBJECTS[key] || notificationEventLabel(key), signoff: SIGNOFF, cta: "", ctaLink: "" };

  switch (key) {
    case "voice_booking_invitation":
      return {
        ...base,
        heading: "Schedule your AI voice interview",
        message: `Dear ${name},\n\nWe are pleased to invite you to schedule your AI voice interview for ${rolePhrase}. Please use the secure link below to select an available interview time. This link expires automatically.\n\nWe look forward to speaking with you.`,
        cta: "Choose your interview time",
        ctaLink: link,
      };
    case "voice_booking_confirmation":
      return {
        ...base,
        heading: "Your AI voice interview is confirmed",
        message: `Dear ${name},\n\nThis confirms your AI voice interview for ${rolePhrase}.${scheduled ? `\n\nScheduled for: ${scheduled}` : ""}\n\nOur AI interviewer, Ella, will call you at your preferred mobile number around this time. Please make sure you are available and in a quiet location.`,
        cta: "",
        ctaLink: "",
      };
    case "final_booking_invitation":
      return {
        ...base,
        heading: "Schedule your final interview",
        message: `Hi ${name},\n\nThank you for completing your AI voice interview. We are pleased to invite you to the final interview stage for ${rolePhrase}. Please use the secure link below to select your preferred interview time. This link expires automatically.`,
        cta: "Schedule final interview",
        ctaLink: link,
      };
    default:
      return {
        ...base,
        heading: notificationEventLabel(key),
        message: `Dear ${name},\n\n${notificationSummary(key)}`,
        cta: link ? "Open secure link" : "",
        ctaLink: link,
      };
  }
}
