// Pure, dependency-free rules for the Live Avatar interview record: consent
// wording and version, processing states, transcript normalization, question
// and answer pairing, and validation of the HR review analysis. Everything
// here is deterministic so it can be unit-tested without a database or the
// LiveAvatar/OpenAI providers.
//
// The analysis is an HR review aid. It must be grounded in what the applicant
// said about job-related topics; it never scores faces, voices, emotions,
// eye movement, personality, honesty, or protected characteristics.

import { z } from "zod";

export const LIVE_INTERVIEW_STATUSES = [
  "NOT_STARTED",
  "CONSENTED",
  "DEVICE_CHECK",
  "INTERVIEW_IN_PROGRESS",
  "INTERVIEW_COMPLETED",
  "TRANSCRIPTION_PROCESSING",
  "ANALYSIS_PROCESSING",
  "REVIEW_READY",
  "FAILED",
] as const;
export type LiveInterviewStatus = (typeof LIVE_INTERVIEW_STATUSES)[number];

/** Statuses from which the candidate may still (re)run the pre-interview steps. */
export const PRE_INTERVIEW_STATUSES: readonly LiveInterviewStatus[] = ["NOT_STARTED", "CONSENTED", "DEVICE_CHECK"];
/** Statuses after the candidate finished speaking with the avatar. */
export const POST_INTERVIEW_STATUSES: readonly LiveInterviewStatus[] = ["INTERVIEW_COMPLETED", "TRANSCRIPTION_PROCESSING", "ANALYSIS_PROCESSING", "REVIEW_READY", "FAILED"];

export const LIVE_INTERVIEW_STATUS_LABELS: Record<LiveInterviewStatus, string> = {
  NOT_STARTED: "Not started",
  CONSENTED: "Consent given",
  DEVICE_CHECK: "Device check",
  INTERVIEW_IN_PROGRESS: "Interview in progress",
  INTERVIEW_COMPLETED: "Interview completed",
  TRANSCRIPTION_PROCESSING: "Transcript processing",
  ANALYSIS_PROCESSING: "AI review processing",
  REVIEW_READY: "Review ready",
  FAILED: "Processing failed",
};

export function isLiveInterviewStatus(value: unknown): value is LiveInterviewStatus {
  return typeof value === "string" && (LIVE_INTERVIEW_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Interview state vs analysis state
// ---------------------------------------------------------------------------
//
// `status` above is the processing pipeline's position. It is not shown to HR
// as-is: a downstream failure (transcript retrieval, AI analysis) leaves the
// session at FAILED, but the interview itself was completed. HR sees two
// independent states derived from the stored record, so existing rows need no
// migration.

export type InterviewState = "not_started" | "in_progress" | "completed";
export type AnalysisState = "pending" | "processing" | "completed" | "failed";

export const INTERVIEW_STATE_LABELS: Record<InterviewState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
};

export const ANALYSIS_STATE_LABELS: Record<AnalysisState, string> = {
  pending: "Pending",
  processing: "Processing",
  completed: "Completed",
  failed: "Analysis unavailable — retry available",
};

export function deriveInterviewState(status: LiveInterviewStatus): InterviewState {
  if (PRE_INTERVIEW_STATUSES.includes(status)) return "not_started";
  if (status === "INTERVIEW_IN_PROGRESS") return "in_progress";
  return "completed";
}

export function deriveAnalysisState(status: LiveInterviewStatus, hasAnalysis: boolean): AnalysisState {
  if (hasAnalysis) return "completed";
  if (status === "FAILED" || status === "REVIEW_READY") return "failed";
  if (status === "TRANSCRIPTION_PROCESSING" || status === "ANALYSIS_PROCESSING") return "processing";
  return "pending";
}

/** HR-facing wording for a failed processing stage. Never includes the technical cause. */
export function processingFailureMessage(stage: string, retriedByHr: boolean) {
  if (stage === "transcription") {
    return retriedByHr
      ? "The interview transcript is temporarily unavailable. The interview itself has been saved. Please try again later or contact your system administrator."
      : "The interview transcript could not be retrieved automatically. The interview itself has been saved. Please retry processing.";
  }
  return retriedByHr
    ? "Interview analysis is temporarily unavailable. The interview recording and transcript remain available for review. Please try again later or contact your system administrator."
    : "Interview analysis could not be completed. The recording and transcript have been safely preserved. Please retry the analysis.";
}

/**
 * Review flags are shown to HR. Failure flags are always rendered from fixed
 * wording by code, which also cleans records written before this rule (they
 * embedded raw provider errors such as "400 Response input messages…").
 */
const SAFE_FLAG_MESSAGES: Record<string, string> = {
  analysis_failed: "AI interview analysis could not be completed automatically. The recording and transcript are preserved and the analysis can be retried.",
  transcription_failed: "The interview transcript could not be retrieved automatically.",
  completion_failed: "The interview could not be linked to the application automatically.",
  recording_failed: "The interview recording is not available.",
};

export function safeReviewFlags(flags: unknown): ReviewFlag[] {
  if (!Array.isArray(flags)) return [];
  return (flags as ReviewFlag[])
    .filter((flag) => flag && typeof flag.code === "string")
    .map((flag) => SAFE_FLAG_MESSAGES[flag.code] ? { code: flag.code, message: SAFE_FLAG_MESSAGES[flag.code] } : { code: flag.code, message: String(flag.message ?? "") });
}

export function removeReviewFlag(flags: unknown, code: string): ReviewFlag[] {
  return Array.isArray(flags) ? (flags as ReviewFlag[]).filter((flag) => flag && flag.code !== code) : [];
}

/**
 * Exponential backoff before the next automatic analysis attempt after a
 * transient failure (15 s, 1 min, 4 min, 16 min, capped at 30 min).
 */
export function analysisRetryDelayMs(attempt: number) {
  return Math.min(15_000 * 4 ** Math.max(0, attempt - 1), 30 * 60 * 1000);
}

// Bump the version whenever the wording below changes, so every stored consent
// record identifies exactly which notice the applicant agreed to.
export const INTERVIEW_CONSENT_VERSION = "2026-09-25.v1";
export const INTERVIEW_CONSENT_TITLE = "AI Interview Recording & Monitoring Consent";
export const INTERVIEW_CONSENT_PARAGRAPHS = [
  "Before continuing, please review and acknowledge the following.",
  "This interview is conducted with an AI-assisted interview system. During the interview, your audio, video, and interview responses may be recorded and reviewed as part of the recruitment process.",
  "The system may capture information from the interview session, including your spoken responses and video recording, for interview review, quality assurance, security, and interview-integrity purposes.",
  "Please complete the interview independently and without unauthorized assistance. Integrity and professionalism are important throughout our recruitment process.",
  "By selecting “I Agree & Continue,” you acknowledge that you have read this notice and consent to the recording and processing of your interview session for recruitment-related purposes.",
] as const;

/** Friendly wording for getUserMedia failures — never raw DOMException text. */
export function deviceErrorMessage(error: unknown, device: "camera" | "microphone" | "camera and microphone") {
  const name = error instanceof DOMException ? error.name : (error as { name?: string })?.name || "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return `Access to your ${device} was blocked. Click the camera/lock icon in your browser's address bar, allow the ${device}, then select "Try again".`;
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return `No ${device} was detected. Connect a ${device === "microphone" ? "microphone or headset" : "webcam"} and select "Try again".`;
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return `Your ${device} is being used by another application (for example Zoom, Teams, or another browser tab). Close it and select "Try again".`;
    default:
      return `We could not access your ${device}. Check that it is connected and allowed for this site, then select "Try again".`;
  }
}

export const HR_REVIEW_DISCLAIMER = "AI-generated interview review. This information is provided to assist HR review and should be evaluated together with the applicant's qualifications and the complete interview record.";

export type TranscriptSpeaker = "ai_interviewer" | "applicant";
export type TranscriptSource = "provider" | "client_capture";

export type TranscriptTurn = {
  seq: number;
  speaker: TranscriptSpeaker;
  text: string;
  occurredAt: string | null;
  relativeMs: number | null;
  questionIndex: number | null;
  source: TranscriptSource;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clamp(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

const MAX_TURNS = 400;
const MAX_TURN_CHARS = 4000;

function speakerFromRole(role: unknown): TranscriptSpeaker | null {
  const value = clean(role).toLowerCase();
  if (["avatar", "assistant", "agent", "ai", "ai_interviewer", "interviewer"].includes(value)) return "ai_interviewer";
  if (["user", "candidate", "applicant", "human"].includes(value)) return "applicant";
  return null;
}

/** LiveAvatar timestamps are epoch seconds; tolerate milliseconds too. */
function epochMillis(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number < 1e12 ? Math.round(number * 1000) : Math.round(number);
}

/**
 * Normalize LiveAvatar `GET /v1/sessions/{id}/transcript` `transcript_data`
 * items (`role`, `transcript`, `absolute_timestamp`, `relative_timestamp`).
 */
export function normalizeProviderTranscript(items: unknown): TranscriptTurn[] {
  if (!Array.isArray(items)) return [];
  const turns: Omit<TranscriptTurn, "seq" | "questionIndex">[] = [];
  let firstAt: number | null = null;
  for (const item of items.slice(0, MAX_TURNS)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const speaker = speakerFromRole(record.role);
    const text = clamp(clean(record.transcript ?? record.text), MAX_TURN_CHARS);
    if (!speaker || !text) continue;
    const at = epochMillis(record.absolute_timestamp);
    if (at !== null && firstAt === null) firstAt = at;
    const relative = typeof record.relative_timestamp === "number" && Number.isFinite(record.relative_timestamp)
      ? Math.max(0, Math.round(record.relative_timestamp < 1e5 ? record.relative_timestamp * 1000 : record.relative_timestamp))
      : null;
    turns.push({
      speaker,
      text,
      occurredAt: at !== null ? new Date(at).toISOString() : null,
      relativeMs: at !== null && firstAt !== null ? at - firstAt : relative,
      source: "provider",
    });
  }
  return assignQuestionIndexes(turns.map((turn, index) => ({ ...turn, seq: index + 1, questionIndex: null })));
}

export type ClientTranscriptEvent = { speaker: TranscriptSpeaker; text: string; at: string };

/** Validate browser-captured SDK transcription events (fallback source only). */
export function sanitizeClientTranscript(items: unknown): ClientTranscriptEvent[] {
  if (!Array.isArray(items)) return [];
  const events: ClientTranscriptEvent[] = [];
  for (const item of items.slice(0, MAX_TURNS)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const speaker = speakerFromRole(record.speaker);
    const text = clamp(clean(record.text), MAX_TURN_CHARS);
    const at = new Date(String(record.at ?? ""));
    if (!speaker || !text || Number.isNaN(at.getTime())) continue;
    events.push({ speaker, text, at: at.toISOString() });
  }
  return events;
}

export function normalizeClientTranscript(events: ClientTranscriptEvent[]): TranscriptTurn[] {
  const sorted = [...events].sort((left, right) => left.at.localeCompare(right.at));
  const firstAt = sorted.length ? Date.parse(sorted[0].at) : 0;
  return assignQuestionIndexes(sorted.map((event, index) => ({
    seq: index + 1,
    speaker: event.speaker,
    text: event.text,
    occurredAt: event.at,
    relativeMs: Date.parse(event.at) - firstAt,
    questionIndex: null,
    source: "client_capture" as const,
  })));
}

/**
 * An AI interviewer turn that asks something ("?") opens a new question; the
 * applicant turns that follow belong to it until the next question. Greetings
 * before the first question stay unassigned (null).
 */
export function assignQuestionIndexes(turns: TranscriptTurn[]): TranscriptTurn[] {
  let current: number | null = null;
  let count = 0;
  return turns.map((turn) => {
    if (turn.speaker === "ai_interviewer" && turn.text.includes("?")) {
      count += 1;
      current = count;
    }
    return { ...turn, questionIndex: current };
  });
}

export type QuestionPair = {
  questionIndex: number;
  question: string;
  answer: string;
  askedAt: string | null;
  turnSeqs: number[];
};

function wordCount(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

const TRIVIAL_ANSWER = /^(yes|yeah|yep|no|nope|okay|ok|sure|thanks|thank you|ready|i'?m ready|hello|hi)[.!]?$/i;

/**
 * Deterministic question → verbatim answer pairs. The answer is the
 * applicant's own words, never an AI paraphrase. Housekeeping exchanges such
 * as "Can you hear me?" / "Yes." are left out as non-substantive.
 */
export function buildQuestionPairs(turns: TranscriptTurn[]): QuestionPair[] {
  const byIndex = new Map<number, TranscriptTurn[]>();
  for (const turn of turns) {
    if (turn.questionIndex === null) continue;
    const list = byIndex.get(turn.questionIndex) || [];
    list.push(turn);
    byIndex.set(turn.questionIndex, list);
  }
  const pairs: QuestionPair[] = [];
  for (const [questionIndex, group] of [...byIndex.entries()].sort(([left], [right]) => left - right)) {
    const opener = group.find((turn) => turn.speaker === "ai_interviewer");
    if (!opener) continue;
    const answerTurns = group.filter((turn) => turn.speaker === "applicant");
    const answer = answerTurns.map((turn) => turn.text).join(" ").trim();
    const substantiveQuestion = wordCount(opener.text) >= 6;
    const substantiveAnswer = wordCount(answer) >= 5 && !TRIVIAL_ANSWER.test(answer);
    if (!substantiveQuestion && !substantiveAnswer) continue;
    pairs.push({
      questionIndex,
      question: opener.text,
      answer,
      askedAt: opener.occurredAt,
      turnSeqs: group.map((turn) => turn.seq),
    });
  }
  return pairs;
}

export function transcriptDurationSeconds(turns: TranscriptTurn[]) {
  const times = turns.map((turn) => (turn.occurredAt ? Date.parse(turn.occurredAt) : NaN)).filter(Number.isFinite);
  if (times.length < 2) return null;
  return Math.max(0, Math.round((Math.max(...times) - Math.min(...times)) / 1000));
}

export function transcriptPlainText(turns: TranscriptTurn[]) {
  return turns.map((turn) => `${turn.speaker === "ai_interviewer" ? "AI Interviewer" : "Applicant"}: ${turn.text}`).join("\n");
}

// ---------------------------------------------------------------------------
// HR review analysis
// ---------------------------------------------------------------------------

// Wrong types still fail validation (and the analysis is retried), but
// over-long text is clamped, extra items are trimmed, and blank items are
// dropped, so one untidy field never discards an otherwise valid analysis.
const text = (max: number) => z.string().default("").transform((value) => clamp(value.trim(), max));
const list = <T extends z.ZodTypeAny>(item: T, max: number, keep: (value: z.infer<T>) => boolean = () => true) =>
  z.array(item).default([]).transform((items) => items.filter(keep).slice(0, max));
const turnRefs = z.array(z.number().int()).default([]).transform((refs) => refs.filter((ref) => ref > 0).slice(0, 12));

export const interviewAnalysisSchema = z.object({
  interviewSummary: text(2000),
  relevantExperience: list(z.object({ point: text(1200), evidence: text(1200), turnRefs }), 10, (item) => item.point.length > 0),
  skillsMentioned: list(z.object({ skill: text(120), evidence: text(1200), turnRefs }), 20, (item) => item.skill.length > 0),
  strengthsEvidenced: list(z.object({ strength: text(1200), evidence: text(1200), turnRefs }), 10, (item) => item.strength.length > 0),
  areasToClarify: list(z.object({ topic: text(1200), reason: text(1200), turnRefs }), 10, (item) => item.topic.length > 0),
  notableResponses: list(z.object({ title: text(1200), quote: text(1200), turnRefs }), 8, (item) => item.title.length > 0),
  questionReviews: list(z.object({
    questionIndex: z.number().int(),
    rating: z.number().int().min(0).max(4).nullable().default(null),
    analysis: text(1500),
    jobCriteria: text(300),
    evidence: text(1200),
  }), 40),
});
export type InterviewAnalysis = z.output<typeof interviewAnalysisSchema>;

/**
 * Guardrail: remove any statement that infers from appearance, voice, emotion,
 * gaze, body language, personality, honesty, or protected characteristics.
 * The prompt already forbids this; the filter enforces it after the fact.
 */
// Terms are chosen to avoid common job vocabulary false positives such as
// "face-to-face", "regular expression", "security posture", "race condition",
// or "disabled the feature".
const PROHIBITED_INFERENCE = /\b(facial|emotion(?:al|s)?|eye[- ]?(?:contact|movement)|gaze|body language|nervous(?:ness)?|anxious|anxiety|confiden(?:t|ce)|personality|introvert(?:ed)?|extrovert(?:ed)?|honest(?:y)?|dishonest(?:y)?|lying|liar|truthful(?:ness)?|deceptive|deception|accent|tone of voice|physical appearance|attractive|ethnic(?:ity)?|racial|gender|disabilit(?:y|ies)|religio(?:n|us)|pregnan(?:t|cy)|nationality|sexual orientation)\b/i;

export function containsProhibitedInference(value: string) {
  return PROHIBITED_INFERENCE.test(value);
}

function validRefs(refs: number[], maxSeq: number) {
  return [...new Set(refs.filter((ref) => ref >= 1 && ref <= maxSeq))].slice(0, 12);
}

/**
 * Parse and ground raw model output: invalid shapes throw (so the job is
 * retried rather than stored), transcript references outside the transcript
 * are dropped, per-question reviews must match a real question, and any item
 * containing a prohibited inference is removed.
 */
export function sanitizeInterviewAnalysis(raw: unknown, context: { pairs: QuestionPair[]; maxSeq: number }): InterviewAnalysis {
  const parsed = interviewAnalysisSchema.parse(raw);
  const allowed = (...values: string[]) => !values.some(containsProhibitedInference);
  const knownQuestions = new Set(context.pairs.map((pair) => pair.questionIndex));
  const summarySentences = parsed.interviewSummary.split(/(?<=[.!?])\s+/).filter((sentence) => allowed(sentence));
  return {
    interviewSummary: summarySentences.join(" ").trim(),
    relevantExperience: parsed.relevantExperience.filter((item) => allowed(item.point, item.evidence)).map((item) => ({ ...item, turnRefs: validRefs(item.turnRefs, context.maxSeq) })),
    skillsMentioned: parsed.skillsMentioned.filter((item) => allowed(item.skill, item.evidence)).map((item) => ({ ...item, turnRefs: validRefs(item.turnRefs, context.maxSeq) })),
    strengthsEvidenced: parsed.strengthsEvidenced.filter((item) => allowed(item.strength, item.evidence) && item.evidence.length > 0).map((item) => ({ ...item, turnRefs: validRefs(item.turnRefs, context.maxSeq) })),
    areasToClarify: parsed.areasToClarify.filter((item) => allowed(item.topic, item.reason)).map((item) => ({ ...item, turnRefs: validRefs(item.turnRefs, context.maxSeq) })),
    notableResponses: parsed.notableResponses.filter((item) => allowed(item.title, item.quote)).map((item) => ({ ...item, turnRefs: validRefs(item.turnRefs, context.maxSeq) })),
    questionReviews: parsed.questionReviews
      .filter((item) => knownQuestions.has(item.questionIndex))
      .map((item) => allowed(item.analysis, item.evidence, item.jobCriteria)
        ? item
        : { ...item, analysis: "", evidence: "", jobCriteria: allowed(item.jobCriteria) ? item.jobCriteria : "" }),
  };
}

// ---------------------------------------------------------------------------
// Objective integrity indicators (review indicators only)
// ---------------------------------------------------------------------------

export const INTEGRITY_EVENT_TYPES = [
  "tab_hidden",
  "tab_visible",
  "window_blur",
  "network_offline",
  "network_online",
  "avatar_disconnected",
  "page_unloaded",
  "text_pasted",
  "microphone_fallback",
] as const;
export type IntegrityEventType = (typeof INTEGRITY_EVENT_TYPES)[number];

export const INTEGRITY_EVENT_LABELS: Record<IntegrityEventType, string> = {
  tab_hidden: "Interview tab was hidden",
  tab_visible: "Interview tab became visible again",
  window_blur: "Interview window lost focus",
  network_offline: "Browser reported a network disconnection",
  network_online: "Browser network connection restored",
  avatar_disconnected: "Avatar session disconnected",
  page_unloaded: "Interview page was closed or reloaded",
  text_pasted: "Text was pasted into the typed-response box",
  microphone_fallback: "Microphone unavailable; text/browser voice fallback used",
};

export type IntegrityEvent = { type: IntegrityEventType; at: string; detail: string };

export function sanitizeIntegrityEvents(items: unknown, limit = 50): IntegrityEvent[] {
  if (!Array.isArray(items)) return [];
  const events: IntegrityEvent[] = [];
  for (const item of items.slice(0, limit)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const type = clean(record.type) as IntegrityEventType;
    const at = new Date(String(record.at ?? ""));
    if (!(INTEGRITY_EVENT_TYPES as readonly string[]).includes(type) || Number.isNaN(at.getTime())) continue;
    events.push({ type, at: at.toISOString(), detail: clamp(clean(record.detail), 200) });
  }
  return events;
}

export type ReviewFlag = { code: string; message: string };

export function addReviewFlag(flags: unknown, flag: ReviewFlag): ReviewFlag[] {
  const existing = Array.isArray(flags) ? (flags as ReviewFlag[]).filter((item) => item && typeof item.code === "string") : [];
  return existing.some((item) => item.code === flag.code) ? existing : [...existing, flag];
}
