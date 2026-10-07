/**
 * One rule for when an HR decision needs a comment, shared by the single
 * applicant decision (panel + API) and bulk approval. Approving never needs
 * one (a note is optional); rejecting still needs a short reason so the
 * history explains why. Kept free of imports so it can be unit tested.
 */

export const DECISION_COMMENT_MAX_LENGTH = 5000;
export const REJECTION_REASON_REQUIRED_MESSAGE = "Add a short reason before rejecting this applicant.";

export function decisionCommentRequired(decision: string): boolean {
  return decision.trim().toLowerCase() === "reject";
}

/** The comment to store: the HR note when given, otherwise "" (approvals need none). */
export function decisionComment(decision: string, comment: string | null | undefined): { ok: true; comment: string } | { ok: false; error: string } {
  const trimmed = String(comment ?? "").trim();
  if (trimmed.length > DECISION_COMMENT_MAX_LENGTH) return { ok: false, error: `Keep the note under ${DECISION_COMMENT_MAX_LENGTH} characters.` };
  if (!trimmed && decisionCommentRequired(decision)) return { ok: false, error: REJECTION_REASON_REQUIRED_MESSAGE };
  return { ok: true, comment: trimmed };
}
