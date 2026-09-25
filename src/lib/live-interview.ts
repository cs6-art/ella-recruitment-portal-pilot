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

const shortText = z.string().trim().min(1).max(1200);
const turnRefs = z.array(z.number().int().positive()).max(12).default([]);

export const interviewAnalysisSchema = z.object({
  interviewSummary: z.string().trim().max(2000).default(""),
  relevantExperience: z.array(z.object({ point: shortText, evidence: z.string().trim().max(1200).default(""), turnRefs })).max(10).default([]),
  skillsMentioned: z.array(z.object({ skill: z.string().trim().min(1).max(120), evidence: z.string().trim().max(1200).default(""), turnRefs })).max(20).default([]),
  strengthsEvidenced: z.array(z.object({ strength: shortText, evidence: z.string().trim().max(1200).default(""), turnRefs })).max(10).default([]),
  areasToClarify: z.array(z.object({ topic: shortText, reason: z.string().trim().max(1200).default(""), turnRefs })).max(10).default([]),
  notableResponses: z.array(z.object({ title: shortText, quote: z.string().trim().max(1200).default(""), turnRefs })).max(8).default([]),
  questionReviews: z.array(z.object({
    questionIndex: z.number().int().positive(),
    analysis: z.string().trim().max(1500).default(""),
    jobCriteria: z.string().trim().max(300).default(""),
    evidence: z.string().trim().max(1200).default(""),
  })).max(40).default([]),
});
export type InterviewAnalysis = z.infer<typeof interviewAnalysisSchema>;

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
