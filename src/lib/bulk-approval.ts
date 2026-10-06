/**
 * Outcomes and the HR-facing summary for "Approve for Interview" on several
 * applicants at once. Kept free of imports so it can be unit tested directly.
 */

export const MAX_BULK_APPROVAL = 100;

export type BulkApprovalOutcome =
  | "approved"
  | "already_approved"
  | "interview_exists"
  | "screening_pending"
  | "not_eligible"
  | "not_found"
  | "failed";

const SKIP_REASONS: Record<Exclude<BulkApprovalOutcome, "approved" | "failed">, [string, string]> = {
  already_approved: ["was already approved for interview", "were already approved for interview"],
  interview_exists: ["skipped because an interview already exists", "skipped because an interview already exists"],
  screening_pending: ["skipped because screening is not finished", "skipped because screening is not finished"],
  not_eligible: ["skipped because they are no longer in Resume Review", "skipped because they are no longer in Resume Review"],
  not_found: ["could not be found", "could not be found"],
};

function applicants(count: number) {
  return `${count} ${count === 1 ? "applicant" : "applicants"}`;
}

export function summarizeBulkApproval(outcomes: BulkApprovalOutcome[]) {
  const counts = outcomes.reduce<Record<BulkApprovalOutcome, number>>((totals, outcome) => {
    totals[outcome] += 1;
    return totals;
  }, { approved: 0, already_approved: 0, interview_exists: 0, screening_pending: 0, not_eligible: 0, not_found: 0, failed: 0 });

  const parts: string[] = [];
  parts.push(counts.approved > 0 ? `${applicants(counts.approved)} approved for interview.` : "No applicants were approved.");
  for (const key of Object.keys(SKIP_REASONS) as (keyof typeof SKIP_REASONS)[]) {
    const count = counts[key];
    if (count === 0) continue;
    const [singular, plural] = SKIP_REASONS[key];
    parts.push(`${applicants(count)} ${count === 1 ? singular : plural}.`);
  }
  if (counts.failed > 0) parts.push(`${applicants(counts.failed)} could not be approved. Please try again.`);
  return { counts, message: parts.join(" ") };
}
