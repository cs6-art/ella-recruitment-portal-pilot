// Auditable, job-related scoring of a live avatar interview.
//
// Design rules (kept deliberately conservative to limit discrimination risk):
//  * The model only *rates each answer* on an anchored 0-4 evidence scale. The
//    0-100 score, status band, and suggested next step are computed here, in
//    code, so they are reproducible and explainable.
//  * Ratings measure only how much specific, job-related evidence the
//    applicant's own words contain. Fluency, grammar, accent, vocabulary,
//    speaking speed, pauses, tone, and answer length are NOT criteria.
//  * A rating counts only when its supporting quote can be found in the
//    applicant's answer. Unsupported ratings are dropped, never trusted.
//  * Technical problems are never penalised: interrupted interviews, fallback
//    transcripts, or too few assessable answers produce "not scored" for
//    manual HR review instead of a low score.
//  * The applicant's name/contact details are removed before the model sees
//    the transcript.
//  * Nothing here rejects or advances anyone; it is guidance for HR.

import type { InterviewAnalysis, QuestionPair, TranscriptTurn } from "./live-interview.ts";

export const RUBRIC_VERSION = "2026-09-25.v1";
/** Fewer assessable answers than this is not enough evidence to score. */
export const MIN_ASSESSABLE_ANSWERS = 2;

export const RATING_SCALE = [
  { rating: 0, label: "Not addressed", description: "The answer did not address the question." },
  { rating: 1, label: "Very limited", description: "A general statement with no specific example or detail." },
  { rating: 2, label: "Partial", description: "Relevant, but missing specifics such as what was done, how, or the result." },
  { rating: 3, label: "Good", description: "A specific, relevant example describing the applicant's own actions." },
  { rating: 4, label: "Strong", description: "A specific, relevant example with the applicant's actions and an outcome or result." },
] as const;

export type AssessmentBand = "strong" | "good" | "partial" | "limited";

export const BAND_LABELS: Record<AssessmentBand, string> = {
  strong: "Strong job-related evidence",
  good: "Good job-related evidence",
  partial: "Partial evidence — clarification recommended",
  limited: "Limited evidence in answers",
};

export const BAND_NEXT_STEPS: Record<AssessmentBand, string> = {
  strong: "Ready for HR decision",
  good: "Ready for HR decision",
  partial: "Review answers and consider follow-up questions",
  limited: "HR to review the full interview before deciding",
};

export const NOT_SCORED_LABEL = "Not scored — manual HR review";
export const NOT_SCORED_NEXT_STEP = "Manual HR review — no score was produced";

export const ASSESSMENT_BASIS = "Scores reflect only how much specific, job-related evidence the applicant's own words contain, rated against a fixed 0–4 scale for each question. Fluency, grammar, accent, vocabulary, speaking speed, tone, answer length, appearance, and video or audio behaviour are not assessed. The score is guidance for HR, not a hiring decision.";

export function ratingLabel(rating: number | null) {
  return RATING_SCALE.find((item) => item.rating === rating)?.label || "";
}

export type QuestionRating = {
  questionIndex: number;
  rating: number | null;
  counted: boolean;
  reason: string;
};

export type InterviewAssessment = {
  rubricVersion: string;
  status: "scored" | "not_scored";
  score: number | null;
  band: AssessmentBand | null;
  bandLabel: string;
  suggestedNextStep: string;
  countedQuestions: number;
  totalQuestions: number;
  questionRatings: QuestionRating[];
  notScoredReason: string;
};

export type StoredInterviewAnalysis = InterviewAnalysis & { assessment?: InterviewAssessment };

function words(value: string) {
  return value.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

/** A quote is supported when nearly all of its words appear in the applicant's answer. */
export function evidenceSupported(quote: string, answer: string) {
  const quoteWords = words(quote).filter((word) => word !== "applicant");
  if (quoteWords.length < 3) return false;
  const answerWords = new Set(words(answer));
  const found = quoteWords.filter((word) => answerWords.has(word)).length;
  return found / quoteWords.length >= 0.85;
}

export function bandForScore(score: number): AssessmentBand {
  if (score >= 75) return "strong";
  if (score >= 55) return "good";
  if (score >= 35) return "partial";
  return "limited";
}

function notScored(reason: string, ratings: QuestionRating[], total: number, counted: number): InterviewAssessment {
  return {
    rubricVersion: RUBRIC_VERSION,
    status: "not_scored",
    score: null,
    band: null,
    bandLabel: NOT_SCORED_LABEL,
    suggestedNextStep: NOT_SCORED_NEXT_STEP,
    countedQuestions: counted,
    totalQuestions: total,
    questionRatings: ratings,
    notScoredReason: reason,
  };
}

/**
 * Deterministic assessment from the model's per-question ratings. `pairs`
 * must be built from the same (redacted) transcript the model rated.
 */
export function computeAssessment(input: {
  pairs: QuestionPair[];
  reviews: { questionIndex: number; rating?: number | null; evidence?: string }[];
  transcriptSource: string;
  interrupted: boolean;
}): InterviewAssessment {
  const byQuestion = new Map(input.reviews.map((review) => [review.questionIndex, review]));
  const ratings: QuestionRating[] = input.pairs.map((pair) => {
    const answerWords = words(pair.answer).length;
    if (answerWords < 5) return { questionIndex: pair.questionIndex, rating: null, counted: false, reason: "No substantive answer was captured for this question, so it is not scored." };
    const review = byQuestion.get(pair.questionIndex);
    const rating = typeof review?.rating === "number" && Number.isInteger(review.rating) && review.rating >= 0 && review.rating <= 4 ? review.rating : null;
    if (rating === null) return { questionIndex: pair.questionIndex, rating: null, counted: false, reason: "No rating was produced for this question." };
    if (rating > 0 && !evidenceSupported(review?.evidence || "", pair.answer)) {
      return { questionIndex: pair.questionIndex, rating, counted: false, reason: "The supporting quote could not be matched to the applicant's words, so the rating is not counted." };
    }
    return { questionIndex: pair.questionIndex, rating, counted: true, reason: "" };
  });
  const counted = ratings.filter((item) => item.counted);
  if (input.interrupted) return notScored("The interview ended before it was finished, so no score was produced.", ratings, ratings.length, counted.length);
  if (input.transcriptSource !== "provider") return notScored("The official session transcript was not available, so no score was produced.", ratings, ratings.length, counted.length);
  if (counted.length < MIN_ASSESSABLE_ANSWERS) return notScored(`Fewer than ${MIN_ASSESSABLE_ANSWERS} answers could be assessed, which is not enough evidence to score.`, ratings, ratings.length, counted.length);
  const total = counted.reduce((sum, item) => sum + (item.rating ?? 0), 0);
  const score = Math.round((total / (counted.length * 4)) * 100);
  const band = bandForScore(score);
  return {
    rubricVersion: RUBRIC_VERSION,
    status: "scored",
    score,
    band,
    bandLabel: BAND_LABELS[band],
    suggestedNextStep: BAND_NEXT_STEPS[band],
    countedQuestions: counted.length,
    totalQuestions: ratings.length,
    questionRatings: ratings,
    notScoredReason: "",
  };
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

/** Blind the transcript before it is sent to the model. */
export function redactApplicantIdentity(turns: TranscriptTurn[], names: string[]): TranscriptTurn[] {
  const nameWords = [...new Set(names.flatMap((name) => words(name)).filter((word) => word.length >= 3))];
  const namePattern = nameWords.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${nameWords.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}])`, "giu") : null;
  return turns.map((turn) => {
    let text = turn.text.replace(EMAIL, "[email]").replace(PHONE, "[phone]");
    if (namePattern) text = text.replace(namePattern, "[Applicant]");
    return { ...turn, text };
  });
}
