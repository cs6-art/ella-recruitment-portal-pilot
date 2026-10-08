/**
 * The one feedback survey, shared by the sign-out prompt and Smile Bot. Kept
 * free of imports so the form, the API route and the tests all use the same
 * questions and rules.
 */

export const FEEDBACK_SOURCES = ["sign_out", "smile_bot"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

export const FEEDBACK_SOURCE_LABELS: Record<FeedbackSource, string> = {
  sign_out: "Sign out",
  smile_bot: "Smile Bot",
};

export const FEEDBACK_TEXT_MAX_LENGTH = 2000;

export type RatingQuestion = { key: "navigationEase" | "taskCompletion" | "aiUsefulness"; question: string; low: string; high: string };

export const FEEDBACK_RATING_QUESTIONS: readonly RatingQuestion[] = [
  { key: "navigationEase", question: "How easy was it to navigate and understand the app?", low: "Very difficult", high: "Very easy" },
  { key: "taskCompletion", question: "Were you able to complete the recruitment tasks you expected to do?", low: "Not at all", high: "Completely" },
  { key: "aiUsefulness", question: "How clear and useful were the AI-generated results or recommendations?", low: "Very unclear / not useful", high: "Very clear / useful" },
];

export const FEEDBACK_ISSUE_QUESTION = "Did you experience any errors, confusing steps, or slow parts while testing the app?";
export const FEEDBACK_ISSUE_DETAIL_PROMPT = "Please describe what happened.";
export const FEEDBACK_IMPROVEMENT_QUESTION = "What is the most important thing we should improve before the app is fully launched?";

export type FeedbackSubmission = {
  source: FeedbackSource;
  navigationEase: number;
  taskCompletion: number;
  aiUsefulness: number;
  experiencedIssue: boolean;
  issueDescription: string;
  improvementSuggestion: string;
};

export type FeedbackParseResult = { ok: true; value: FeedbackSubmission } | { ok: false; error: string };

function rating(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function text(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  return value.trim();
}

/** Validate a submission from the browser. Nothing here is trusted until it passes. */
export function parseFeedback(raw: unknown): FeedbackParseResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Please answer the feedback questions." };
  const body = raw as Record<string, unknown>;
  const source = FEEDBACK_SOURCES.find((candidate) => candidate === body.source);
  if (!source) return { ok: false, error: "Feedback could not be saved." };
  const navigationEase = rating(body.navigationEase);
  const taskCompletion = rating(body.taskCompletion);
  const aiUsefulness = rating(body.aiUsefulness);
  if (navigationEase === null || taskCompletion === null || aiUsefulness === null) return { ok: false, error: "Please choose a rating from 1 to 5 for each question." };
  if (typeof body.experiencedIssue !== "boolean") return { ok: false, error: "Please answer Yes or No about errors, confusing steps, or slow parts." };
  const issueDescription = text(body.issueDescription);
  const improvementSuggestion = text(body.improvementSuggestion);
  if (issueDescription === null || improvementSuggestion === null) return { ok: false, error: "Feedback could not be saved." };
  if (issueDescription.length > FEEDBACK_TEXT_MAX_LENGTH || improvementSuggestion.length > FEEDBACK_TEXT_MAX_LENGTH) return { ok: false, error: `Please keep each answer under ${FEEDBACK_TEXT_MAX_LENGTH} characters.` };
  if (body.experiencedIssue && !issueDescription) return { ok: false, error: "Please describe what happened." };
  return {
    ok: true,
    value: {
      source,
      navigationEase,
      taskCompletion,
      aiUsefulness,
      experiencedIssue: body.experiencedIssue,
      // A "No" answer never carries a description, even if one was typed before switching.
      issueDescription: body.experiencedIssue ? issueDescription : "",
      improvementSuggestion,
    },
  };
}
