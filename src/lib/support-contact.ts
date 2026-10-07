/**
 * Who users contact for portal help, shown in Smile Bot's "Help & Feedback"
 * tab. HRSG is the helpdesk for now; change it with `SUPPORT_EMAIL` and
 * `SUPPORT_NAME` (server-side env) without a code change.
 *
 * Kept free of imports so it can be unit tested directly.
 */

export const DEFAULT_SUPPORT_EMAIL = "hrsg@mclinkgroup.com";
export const DEFAULT_SUPPORT_NAME = "HRSG";

export type SupportContact = { email: string; name: string };

const EMAIL_PATTERN = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export function supportContact(env: Record<string, string | undefined> = process.env): SupportContact {
  const email = String(env.SUPPORT_EMAIL ?? "").trim().toLowerCase();
  const name = String(env.SUPPORT_NAME ?? "").trim().slice(0, 60);
  return {
    email: EMAIL_PATTERN.test(email) ? email : DEFAULT_SUPPORT_EMAIL,
    name: name || DEFAULT_SUPPORT_NAME,
  };
}

export const FEEDBACK_TOPICS = ["Question", "Report an issue", "Suggestion"] as const;
export type FeedbackTopic = (typeof FEEDBACK_TOPICS)[number];
export const FEEDBACK_MESSAGE_MAX_LENGTH = 1500;

/**
 * A `mailto:` link that opens the user's email app with the feedback filled
 * in. Nothing is sent by the portal: the user reviews and sends it themselves.
 */
export function feedbackMailto(input: { to: string; topic: string; message: string; page?: string; userName?: string }): string {
  const topic = (FEEDBACK_TOPICS as readonly string[]).includes(input.topic) ? input.topic : "Question";
  const subject = `Smile Recruitment Portal: ${topic}`;
  const lines = [
    input.message.trim().slice(0, FEEDBACK_MESSAGE_MAX_LENGTH) || "(Please describe your question or issue here.)",
    "",
    "---",
    input.page ? `Page: ${input.page}` : "",
    input.userName ? `From: ${input.userName}` : "",
  ].filter((line, index, all) => line !== "" || index < all.length - 1);
  return `mailto:${input.to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n").trim())}`;
}
