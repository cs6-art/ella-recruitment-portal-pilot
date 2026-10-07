/**
 * Outcomes and the HR-facing messages for approving applicants and sending
 * phone / Live Avatar interviews, one at a time or in bulk. Kept free of
 * imports so it can be unit tested directly.
 */

export const MAX_BULK_APPROVAL = 100;

/** What a bulk action does to each selected applicant. */
export type BulkApplicantAction = "approve" | "voice" | "avatar";

export type BulkApprovalOutcome =
  | "approved"
  | "already_approved"
  | "already_invited"
  | "interview_exists"
  | "screening_pending"
  | "not_eligible"
  | "not_found"
  | "insufficient_credits"
  | "not_allowed_for_role"
  | "failed";

const SKIP_REASONS: Record<Exclude<BulkApprovalOutcome, "approved" | "failed">, [string, string]> = {
  already_approved: ["was already approved for interview", "were already approved for interview"],
  already_invited: ["skipped because an interview invitation is already active", "skipped because an interview invitation is already active"],
  interview_exists: ["skipped because an interview already exists", "skipped because an interview already exists"],
  screening_pending: ["skipped because screening is not finished", "skipped because screening is not finished"],
  not_eligible: ["skipped because they are no longer in Resume Review", "skipped because they are no longer in Resume Review"],
  not_found: ["could not be found", "could not be found"],
  insufficient_credits: ["skipped because there are not enough Smile Credits for an interview", "skipped because there are not enough Smile Credits for an interview"],
  not_allowed_for_role: ["skipped because their role doesn't use this interview type", "skipped because their role doesn't use this interview type"],
};

const DONE: Record<BulkApplicantAction, string> = {
  approve: "approved for interview",
  voice: "sent a phone interview",
  avatar: "sent a Live Avatar interview",
};

function applicants(count: number) {
  return `${count} ${count === 1 ? "applicant" : "applicants"}`;
}

export function summarizeBulkApproval(outcomes: BulkApprovalOutcome[], action: BulkApplicantAction = "approve") {
  const counts = outcomes.reduce<Record<BulkApprovalOutcome, number>>((totals, outcome) => {
    totals[outcome] += 1;
    return totals;
  }, { approved: 0, already_approved: 0, already_invited: 0, interview_exists: 0, screening_pending: 0, not_eligible: 0, not_found: 0, insufficient_credits: 0, not_allowed_for_role: 0, failed: 0 });

  const parts: string[] = [];
  parts.push(counts.approved > 0 ? `${applicants(counts.approved)} ${DONE[action]}.` : action === "approve" ? "No applicants were approved." : "No interviews were sent.");
  for (const key of Object.keys(SKIP_REASONS) as (keyof typeof SKIP_REASONS)[]) {
    const count = counts[key];
    if (count === 0) continue;
    const [singular, plural] = SKIP_REASONS[key];
    parts.push(`${applicants(count)} ${count === 1 ? singular : plural}.`);
  }
  if (counts.failed > 0) parts.push(`${applicants(counts.failed)} could not be ${action === "approve" ? "approved" : "sent an interview"}. Please try again.`);
  return { counts, message: parts.join(" ") };
}

const INTERVIEW_NAME = { voice: "phone interview", avatar: "Live Avatar interview" } as const;

/** The message HR sees after "Send Phone Interview" / "Send Avatar Interview" on one applicant. */
export function interviewInvitationMessage(kind: "voice" | "avatar", outcome: string, activeKind?: "voice" | "avatar", options: { canSwitch?: boolean; switched?: boolean } = {}): string {
  switch (outcome) {
    case "sent": return options.switched
      ? `Interview changed to a ${INTERVIEW_NAME[kind]}. The earlier invitation link no longer works, and the applicant will receive the new invitation by email.`
      : `${kind === "avatar" ? "Live Avatar" : "Phone"} interview sent. The applicant will receive the invitation by email.`;
    case "already_invited": return options.canSwitch
      ? `This applicant already has an active ${INTERVIEW_NAME[activeKind || kind]} invitation. You can switch it to a ${INTERVIEW_NAME[kind]} instead.`
      : `This applicant already has an active ${INTERVIEW_NAME[activeKind || kind]} invitation, so no new one was sent.`;
    case "insufficient_credits": return "Not enough Smile Credits for this interview. Top up credits, then send it again.";
    case "interview_exists": return activeKind === "avatar" ? "This applicant already has a Live Avatar interview." : "This applicant is already past the interview invitation step.";
    case "not_eligible": return "This applicant was rejected or withdrew, so an interview can't be sent.";
    case "not_found": return "Applicant not found.";
    case "not_allowed_for_role": return kind === "avatar"
      ? "This role uses Voice Interviews only. Change the role's interview type to send a Live Avatar interview."
      : "This role uses Avatar Interviews only. Change the role's interview type to send a voice interview.";
    default: return "The interview invitation could not be sent. Please try again.";
  }
}
