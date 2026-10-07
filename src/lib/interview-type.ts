/**
 * Per-role "Interview type": which AI interview applicants for a role can be
 * sent — the voice (phone) interview, the Live Avatar interview, or both.
 *
 * "Both" means HR can choose either one for each applicant (and a plain
 * approval keeps inviting the candidate with a choice of the two). It never
 * means the applicant must complete both interviews.
 *
 * Stored in `roles.setup.interviewType` (JSONB), like Interview automation, so
 * it needs no migration. Roles without it read as "both", which is exactly how
 * every role behaved before this setting existed.
 *
 * Kept free of imports so the rule can be unit tested directly.
 */

export const ROLE_INTERVIEW_TYPES = ["voice", "avatar", "both"] as const;
export type RoleInterviewType = (typeof ROLE_INTERVIEW_TYPES)[number];
export type InterviewKind = "voice" | "avatar";

export const DEFAULT_ROLE_INTERVIEW_TYPE: RoleInterviewType = "both";

export const ROLE_INTERVIEW_TYPE_LABELS: Record<RoleInterviewType, string> = {
  voice: "Voice Interview only",
  avatar: "Avatar Interview only",
  both: "Both",
};

export const ROLE_INTERVIEW_TYPE_DESCRIPTIONS: Record<RoleInterviewType, string> = {
  voice: "Applicants get an AI phone interview. They book a time and Smile calls them.",
  avatar: "Applicants get a Live Avatar video interview they can start from the email link.",
  both: "HR chooses the voice or Live Avatar interview for each applicant. Approving offers the candidate both.",
};

export function isRoleInterviewType(value: unknown): value is RoleInterviewType {
  return typeof value === "string" && (ROLE_INTERVIEW_TYPES as readonly string[]).includes(value);
}

/** Read the setting from a role's stored setup, tolerating missing or malformed values. */
export function readRoleInterviewType(setup: unknown): RoleInterviewType {
  const root = setup && typeof setup === "object" && !Array.isArray(setup) ? setup as Record<string, unknown> : {};
  const value = typeof root.interviewType === "string" ? root.interviewType.trim().toLowerCase() : "";
  return isRoleInterviewType(value) ? value : DEFAULT_ROLE_INTERVIEW_TYPE;
}

/** Whether HR may send this interview kind for a role with this setting. */
export function roleAllowsInterview(type: RoleInterviewType, kind: InterviewKind): boolean {
  return type === "both" || type === kind;
}

/** The interviews a plain approval (single, bulk or automatic) invites the candidate to. */
export function approvalInterviewKinds(type: RoleInterviewType): InterviewKind[] {
  return type === "both" ? ["voice", "avatar"] : [type];
}

export function interviewNotAllowedMessage(type: RoleInterviewType): string {
  return type === "voice"
    ? "This role uses Voice Interviews only. Change the role's interview type to send a Live Avatar interview."
    : "This role uses Avatar Interviews only. Change the role's interview type to send a voice interview.";
}

/** History wording for a change made by HR. */
export function interviewTypeChangeComment(previous: RoleInterviewType, next: RoleInterviewType): string {
  return `Interview type changed from ${ROLE_INTERVIEW_TYPE_LABELS[previous]} to ${ROLE_INTERVIEW_TYPE_LABELS[next]}.`;
}
