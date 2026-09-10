import { z } from "zod";

const screeningResultSchema = z.object({
  match_score: z.number().finite().min(0).max(100),
  recommendation: z.literal("For HR Review"),
  ai_summary: z.string().trim().min(1).max(10000),
  strengths: z.array(z.string().trim().min(1)).max(20),
  gaps: z.array(z.string().trim().min(1)).max(20),
  interview_questions: z.array(z.string().trim().min(1)).length(3),
}).strict();

export type ValidatedScreeningResult = z.infer<typeof screeningResultSchema>;

export function parseScreeningResult(value: unknown): ValidatedScreeningResult {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    const rawMatchScore = Object.prototype.hasOwnProperty.call(record, "match_score") ? record.match_score : record.matchScore;
    const normalized: Record<string, unknown> = { ...record, match_score: normalizeMatchScore(rawMatchScore) };
    delete normalized.matchScore;
    return screeningResultSchema.parse(normalized);
  }
  return screeningResultSchema.parse(parsed);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

/**
 * Normalize the score shapes used by the n8n and legacy screening payloads.
 * `undefined` means the field was not supplied or was invalid; `null` means
 * an explicitly empty score. Callers can therefore reject malformed values
 * without treating them as a real zero.
 */
export function normalizeMatchScore(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;
    const numeric = Number(raw.endsWith("%") ? raw.slice(0, -1).trim() : raw);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return undefined;
    return Math.trunc(numeric);
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return undefined;
  return Math.trunc(value);
}

export function buildScreeningPrompt(input: {
  roleTitle: string;
  jobDescription?: string;
  screeningCriteria?: string;
  keywordsToLookFor?: string;
  minimumYearsOfExperience?: string;
  transferableSkillsAccepted?: string;
  licenseOrCertificateRequired?: string;
  candidateName: string;
  candidateEmail: string;
  resumeText: string;
}) {
  return [
    "Screen exactly one candidate against exactly one selected role.",
    "Never approve or reject the candidate. The recommendation must be For HR Review.",
    "Return only JSON with exactly these keys: match_score (number 0-100), recommendation (For HR Review), ai_summary, strengths (array), gaps (array), interview_questions (exactly 3 strings).",
    "Score only against the supplied role. If the candidate is for a different role, score no higher than 49.",
    `ROLE TITLE: ${text(input.roleTitle)}`,
    `JOB DESCRIPTION: ${text(input.jobDescription)}`,
    `SCREENING CRITERIA: ${text(input.screeningCriteria)}`,
    `KEYWORDS: ${text(input.keywordsToLookFor)}`,
    `MINIMUM YEARS: ${text(input.minimumYearsOfExperience)}`,
    `TRANSFERABLE SKILLS: ${text(input.transferableSkillsAccepted)}`,
    `LICENSE/CERTIFICATE: ${text(input.licenseOrCertificateRequired)}`,
    `CANDIDATE NAME: ${text(input.candidateName)}`,
    `CANDIDATE EMAIL: ${text(input.candidateEmail)}`,
    `RESUME TEXT:\n${text(input.resumeText)}`,
  ].join("\n\n");
}

export function screeningDbValues(result: ValidatedScreeningResult) {
  return {
    matchScore: Math.trunc(result.match_score),
    recommendation: result.recommendation,
    summary: result.ai_summary,
    strengths: JSON.stringify(result.strengths),
    gaps: JSON.stringify(result.gaps),
    interviewQuestions: JSON.stringify(result.interview_questions),
    evaluationScores: { match_score: result.match_score },
  };
}
