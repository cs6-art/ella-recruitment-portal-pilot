import OpenAI from "openai";
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
  return screeningResultSchema.parse(parsed);
}

function text(value: unknown) {
  return String(value ?? "").trim();
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

/**
 * The model is the only external boundary. The caller validates the result
 * before it reaches the queue or credit transaction.
 */
export async function screenResume(input: Parameters<typeof buildScreeningPrompt>[0]): Promise<ValidatedScreeningResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("screening_provider_not_configured");
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: process.env.RECRUITMENT_SCREENING_MODEL || "gpt-5-mini",
    messages: [
      {
        role: "system",
        content: "You are a strict, role-grounded recruitment screening assistant. Follow the requested JSON contract exactly and never make the HR decision.",
      },
      { role: "user", content: buildScreeningPrompt(input) },
    ],
    response_format: { type: "json_object" },
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("screening_provider_empty_result");
  return parseScreeningResult(content);
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
