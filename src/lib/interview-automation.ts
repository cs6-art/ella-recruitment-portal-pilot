/**
 * Per-role "Interview automation": invite an applicant to the AI interview
 * automatically when their resume screening score meets the role's minimum.
 *
 * The setting lives in `roles.setup.interviewAutomation` (JSONB), so it needs
 * no migration and roles without it keep the manual HR review. It applies only
 * to applicants whose screening finished after it was last switched on
 * (`enabledAt`), so applicants already waiting stay with HR.
 *
 * Kept free of imports so the rule can be unit tested directly.
 */

export type InterviewAutomation = {
  enabled: boolean;
  minScore: number;
  enabledAt: string;
  enabledBy: string;
};

export const DEFAULT_INTERVIEW_AUTOMATION_MIN_SCORE = 80;

const DISABLED: InterviewAutomation = { enabled: false, minScore: DEFAULT_INTERVIEW_AUTOMATION_MIN_SCORE, enabledAt: "", enabledBy: "" };

function validScore(value: unknown): number | null {
  const score = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(score)) return null;
  const whole = Math.round(score);
  return whole >= 1 && whole <= 100 ? whole : null;
}

/** Read the setting from a role's stored setup, tolerating missing or malformed values. */
export function readInterviewAutomation(setup: unknown): InterviewAutomation {
  const root = setup && typeof setup === "object" && !Array.isArray(setup) ? setup as Record<string, unknown> : {};
  const raw = root.interviewAutomation;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DISABLED };
  const value = raw as Record<string, unknown>;
  const minScore = validScore(value.minScore) ?? DEFAULT_INTERVIEW_AUTOMATION_MIN_SCORE;
  const enabledAt = String(value.enabledAt ?? "").trim();
  // An "on" setting without a valid start time cannot tell new applicants from
  // the backlog, so it is treated as off rather than advancing everyone.
  const enabled = value.enabled === true && Number.isFinite(Date.parse(enabledAt));
  return { enabled, minScore, enabledAt: enabled ? enabledAt : "", enabledBy: enabled ? String(value.enabledBy ?? "").trim() : "" };
}

/** Build the stored value for a change made by HR. Switching on (again) restarts the clock. */
export function nextInterviewAutomation(current: InterviewAutomation, change: { enabled: boolean; minScore: unknown }, actorEmail: string, now = new Date()): InterviewAutomation {
  const minScore = validScore(change.minScore);
  if (minScore === null) throw new Error("Enter a minimum score from 1 to 100.");
  if (!change.enabled) return { enabled: false, minScore, enabledAt: "", enabledBy: "" };
  if (current.enabled) return { ...current, minScore };
  return { enabled: true, minScore, enabledAt: now.toISOString(), enabledBy: actorEmail.trim().toLowerCase() };
}

/** Normalise a stored match score to 0–100 (legacy rows hold fractions such as 0.85). */
export function matchScorePercent(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const numeric = Number(String(value).replace(/[% ,]/g, ""));
  if (!Number.isFinite(numeric)) return null;
  const percent = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
  return Math.max(0, Math.min(100, percent));
}

export type AutoAdvanceCandidate = {
  currentStage: string;
  withdrawn: boolean;
  matchScore: unknown;
  screenedAt: string | Date | null | undefined;
};

export type AutoAdvanceDecision =
  | { advance: true; score: number }
  | { advance: false; reason: "disabled" | "not_in_resume_review" | "withdrawn" | "no_score" | "screened_before_enabled" | "below_threshold" };

/** Whether one application should be invited automatically under the role's setting. */
export function evaluateAutoAdvance(automation: InterviewAutomation, candidate: AutoAdvanceCandidate): AutoAdvanceDecision {
  if (!automation.enabled) return { advance: false, reason: "disabled" };
  if (candidate.withdrawn) return { advance: false, reason: "withdrawn" };
  if (candidate.currentStage !== "resume_review") return { advance: false, reason: "not_in_resume_review" };
  const score = matchScorePercent(candidate.matchScore);
  if (score === null) return { advance: false, reason: "no_score" };
  const screenedAt = candidate.screenedAt instanceof Date ? candidate.screenedAt.getTime() : Date.parse(String(candidate.screenedAt ?? ""));
  if (!Number.isFinite(screenedAt) || screenedAt < Date.parse(automation.enabledAt)) return { advance: false, reason: "screened_before_enabled" };
  if (score < automation.minScore) return { advance: false, reason: "below_threshold" };
  return { advance: true, score };
}

/** An HR approval counts as a manual override when automation is on and this applicant is below its minimum. */
export function isManualOverride(automation: InterviewAutomation, matchScore: unknown): boolean {
  if (!automation.enabled) return false;
  const score = matchScorePercent(matchScore);
  return score === null || score < automation.minScore;
}

export function autoAdvanceComment(score: number, minScore: number): string {
  const shown = Number.isInteger(score) ? String(score) : score.toFixed(1);
  return `Screening score ${shown}% met the role's ${minScore}% minimum for automatic interview invitation.`;
}
