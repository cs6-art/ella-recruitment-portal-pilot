// Persistence and processing for Live Avatar interview sessions (Postgres
// recruitment target only).
//
// Reliability contract:
//   1. The completed interview is committed first (status INTERVIEW_COMPLETED)
//      before any provider or AI call runs.
//   2. The raw transcript is stored next; the application then moves to HR
//      review even if later steps fail.
//   3. AI analysis runs separately, guarded by a lease so only one worker
//      processes a session at a time (duplicate completions/refreshes cannot
//      create duplicate analyses), with bounded retries and a recorded
//      failure reason. A failed analysis never discards the transcript.
//
// Applicant-facing calls are authorised only by the one-time avatar invitation
// token (stored hashed); nothing supplied by the browser selects another
// applicant, application, or role.

import crypto from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import OpenAI from "openai";

import { getTenantDb as getDb } from "@/db/client";
import {
  applicants,
  applications,
  bookingTokens,
  liveInterviewIntegrityEvents,
  liveInterviewSessions,
  liveInterviewTranscriptTurns,
  roles,
  voiceInterviewResults,
} from "@/db/schema-recruitment";
import { completeAvatarInterviewByHash, getAvatarInterviewContext } from "@/lib/internal-recruitment-queries";
import { recordLiveAvatarInterviewDeduction } from "@/lib/ella-credits";
import { buildRoleRequirementsContext } from "@/lib/recruitment-prompt";
import { deleteRecordingDriveConnectionIfUnused } from "@/lib/recording-drive-oauth";
import {
  beginRecordingUpload,
  deleteInterviewRecording,
  isAllowedRecordingMimeType,
  isRecordingStorageConfigured,
  MAX_RECORDING_BYTES,
  uploadRecordingChunk,
} from "@/lib/interview-recording-storage";
import {
  addReviewFlag,
  analysisRetryDelayMs,
  buildQuestionPairs,
  deriveAnalysisState,
  deriveInterviewState,
  INTERVIEW_CONSENT_VERSION,
  normalizeClientTranscript,
  normalizeProviderTranscript,
  PRE_INTERVIEW_STATUSES,
  removeReviewFlag,
  safeReviewFlags,
  sanitizeClientTranscript,
  sanitizeIntegrityEvents,
  transcriptDurationSeconds,
  type AnalysisState,
  type ClientTranscriptEvent,
  type IntegrityEvent,
  type InterviewAnalysis,
  type InterviewState,
  type LiveInterviewStatus,
  type ReviewFlag,
  type TranscriptTurn,
} from "@/lib/live-interview";
import {
  analyzeInterviewTranscript,
  classifyAnalysisError,
  interviewAnalysisApiKey,
  InterviewAnalysisError,
  isInterviewAnalysisConfigured,
  type AnalysisClient,
} from "@/lib/live-interview-analysis";
import { errorReference, logInternalError } from "@/lib/safe-error";
import {
  computeAssessment,
  NOT_SCORED_LABEL,
  redactApplicantIdentity,
  type InterviewAssessment,
  type StoredInterviewAnalysis,
} from "@/lib/live-interview-scoring";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organization-accounts";

const LIVEAVATAR_API_URL = (process.env.LIVEAVATAR_API_URL || "https://api.liveavatar.com").replace(/\/+$/, "");
export const MAX_PROCESSING_ATTEMPTS = 5;
const PROCESSING_LEASE_MS = 4 * 60 * 1000;
/** Provider transcript fetch attempts before falling back to the browser capture. */
const PROVIDER_TRANSCRIPT_ATTEMPTS_BEFORE_FALLBACK = 2;
/** An interview still "in progress" this long after start was abandoned. */
const STALE_IN_PROGRESS_MS = 20 * 60 * 1000;
/** Recording uploads are accepted for this long after the session was created. */
const RECORDING_UPLOAD_WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_INTEGRITY_EVENTS_PER_SESSION = 300;
const PROCESSING_STATUSES: LiveInterviewStatus[] = ["INTERVIEW_COMPLETED", "TRANSCRIPTION_PROCESSING", "ANALYSIS_PROCESSING"];

export class LiveInterviewError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

function hashToken(rawToken: string) {
  return crypto.createHash("sha256").update(rawToken.trim()).digest("hex");
}

function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1000);
}

type SessionRow = typeof liveInterviewSessions.$inferSelect;

async function invitationByHash(tokenHash: string) {
  const [row] = await getDb().select({
    tokenId: bookingTokens.id,
    tokenStatus: bookingTokens.status,
    organizationId: bookingTokens.organizationId,
    applicationId: applications.id,
    applicantId: applications.applicantId,
    roleId: applications.roleId,
  }).from(bookingTokens)
    .innerJoin(applications, eq(applications.id, bookingTokens.applicationId))
    .where(and(eq(bookingTokens.tokenHash, tokenHash), eq(bookingTokens.kind, "avatar")))
    .limit(1);
  return row ?? null;
}

export async function getSessionByToken(rawToken: string): Promise<SessionRow | null> {
  const [row] = await getDb().select({ session: liveInterviewSessions }).from(liveInterviewSessions)
    .innerJoin(bookingTokens, eq(bookingTokens.id, liveInterviewSessions.bookingTokenId))
    .where(and(eq(bookingTokens.tokenHash, hashToken(rawToken)), eq(bookingTokens.kind, "avatar")))
    .limit(1);
  return row?.session ?? null;
}

async function getSessionById(sessionId: string): Promise<SessionRow | null> {
  const [row] = await getDb().select().from(liveInterviewSessions).where(eq(liveInterviewSessions.id, sessionId)).limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Candidate flow: consent -> device check -> start -> progress -> complete
// ---------------------------------------------------------------------------

export async function recordInterviewConsent(input: { rawToken: string; agreed: boolean; consentVersion: string; recording: boolean; camera: boolean; microphone: boolean; userAgent: string }) {
  // Consent is only recorded against a live, unused invitation.
  const context = await getAvatarInterviewContext(input.rawToken);
  if (!context) throw new LiveInterviewError("This interview link has already been used, expired, or is no longer available.", 410, "invitation_unavailable");
  if (input.agreed && input.consentVersion !== INTERVIEW_CONSENT_VERSION) throw new LiveInterviewError("The consent notice has changed. Please reload the page and review it again.", 409, "consent_version_mismatch");
  const invitation = await invitationByHash(hashToken(input.rawToken));
  if (!invitation) throw new LiveInterviewError("This interview link is not available.", 404, "invitation_unavailable");
  const now = new Date();
  const agreed = input.agreed === true;
  const values = {
    status: (agreed ? "CONSENTED" : "NOT_STARTED") as LiveInterviewStatus,
    consentGiven: agreed,
    consentVersion: agreed ? INTERVIEW_CONSENT_VERSION : "",
    consentAt: agreed ? now : null,
    consentDeclinedAt: agreed ? null : now,
    // The notice covers recording, camera and microphone together; the
    // individual flags stay explicit so the record is unambiguous.
    recordingConsent: agreed && input.recording === true,
    cameraConsent: agreed && input.camera === true,
    microphoneConsent: agreed && input.microphone === true,
    consentUserAgent: input.userAgent.slice(0, 400),
    cameraReady: false,
    microphoneReady: false,
    deviceCheckAt: null,
    updatedAt: now,
  };
  const [session] = await getDb().insert(liveInterviewSessions).values({
    organizationId: invitation.organizationId,
    applicationId: invitation.applicationId,
    applicantId: invitation.applicantId,
    roleId: invitation.roleId,
    bookingTokenId: invitation.tokenId,
    ...values,
  }).onConflictDoUpdate({
    target: liveInterviewSessions.bookingTokenId,
    set: values,
    setWhere: inArray(liveInterviewSessions.status, [...PRE_INTERVIEW_STATUSES]),
  }).returning();
  if (!session) throw new LiveInterviewError("This interview has already started.", 409, "interview_already_started");
  return session;
}

export async function recordDeviceCheck(input: { rawToken: string; cameraReady: boolean; microphoneReady: boolean }) {
  const session = await getSessionByToken(input.rawToken);
  if (!session || !session.consentGiven) throw new LiveInterviewError("Please review and accept the interview consent first.", 409, "consent_required");
  if (!PRE_INTERVIEW_STATUSES.includes(session.status as LiveInterviewStatus)) throw new LiveInterviewError("This interview has already started.", 409, "interview_already_started");
  const [updated] = await getDb().update(liveInterviewSessions).set({
    status: "DEVICE_CHECK",
    cameraReady: input.cameraReady === true,
    microphoneReady: input.microphoneReady === true,
    deviceCheckAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(liveInterviewSessions.id, session.id), inArray(liveInterviewSessions.status, [...PRE_INTERVIEW_STATUSES]))).returning();
  if (!updated) throw new LiveInterviewError("This interview has already started.", 409, "interview_already_started");
  return updated;
}

/** Server-side gate before the one-time invitation is consumed. */
export async function assertReadyToStart(rawToken: string) {
  const session = await getSessionByToken(rawToken);
  if (!session || !session.consentGiven || !session.consentAt) throw new LiveInterviewError("Please review and accept the interview consent before starting.", 409, "consent_required");
  if (session.status !== "DEVICE_CHECK" || !session.cameraReady || !session.microphoneReady) throw new LiveInterviewError("Please complete the camera and microphone check before starting.", 409, "device_check_required");
  return session;
}

export async function markInterviewStarted(input: { rawToken: string; providerSessionId: string }) {
  const session = await getSessionByToken(input.rawToken);
  if (!session) return null;
  const storageReady = isRecordingStorageConfigured();
  const recordingStatus = !session.recordingConsent ? "not_consented" : storageReady ? "pending" : "not_configured";
  const flags = recordingStatus === "not_configured"
    ? addReviewFlag(session.reviewFlags, { code: "recording_not_configured", message: "No recording was captured because interview recording storage is not configured." })
    : session.reviewFlags;
  const [updated] = await getDb().update(liveInterviewSessions).set({
    status: "INTERVIEW_IN_PROGRESS",
    providerSessionId: input.providerSessionId,
    interviewStartedAt: new Date(),
    recordingStatus,
    reviewFlags: flags,
    needsHrReview: session.needsHrReview || recordingStatus === "not_configured",
    updatedAt: new Date(),
  }).where(and(eq(liveInterviewSessions.id, session.id), eq(liveInterviewSessions.status, "DEVICE_CHECK"))).returning();
  return updated ?? null;
}

async function saveIntegrityEvents(session: SessionRow, events: IntegrityEvent[]) {
  if (events.length === 0) return 0;
  const db = getDb();
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(liveInterviewIntegrityEvents).where(eq(liveInterviewIntegrityEvents.sessionId, session.id));
  const room = Math.max(0, MAX_INTEGRITY_EVENTS_PER_SESSION - Number(count));
  const accepted = events.slice(0, room);
  if (accepted.length === 0) return 0;
  await db.insert(liveInterviewIntegrityEvents).values(accepted.map((event) => ({
    organizationId: session.organizationId,
    sessionId: session.id,
    eventType: event.type,
    occurredAt: new Date(event.at),
    detail: event.detail,
  })));
  return accepted.length;
}

/**
 * Periodic browser checkpoint during the interview: the SDK transcription
 * events captured so far (a fallback if the provider transcript is missing)
 * plus objective session events.
 */
export async function saveInterviewProgress(input: { rawToken: string; transcript: unknown; integrityEvents: unknown }) {
  const session = await getSessionByToken(input.rawToken);
  if (!session || session.status !== "INTERVIEW_IN_PROGRESS") throw new LiveInterviewError("This interview is not in progress.", 409, "not_in_progress");
  const transcript = sanitizeClientTranscript(input.transcript);
  const stored = Array.isArray(session.clientTranscript) ? session.clientTranscript.length : 0;
  if (transcript.length >= stored && transcript.length > 0) {
    await getDb().update(liveInterviewSessions).set({ clientTranscript: transcript, updatedAt: new Date() }).where(and(eq(liveInterviewSessions.id, session.id), eq(liveInterviewSessions.status, "INTERVIEW_IN_PROGRESS")));
  }
  const saved = await saveIntegrityEvents(session, sanitizeIntegrityEvents(input.integrityEvents));
  return { transcriptTurns: Math.max(transcript.length, stored), integrityEvents: saved };
}

/**
 * Commits the finished interview before any provider/AI work. Idempotent: a
 * second call (double click, refresh, retry) returns the existing session.
 */
export async function completeInterviewSession(input: { rawToken: string; providerSessionId?: string; transcript?: unknown; integrityEvents?: unknown; interrupted?: boolean }) {
  let session = await getSessionByToken(input.rawToken);
  if (!session) throw new LiveInterviewError("This interview was not found.", 404, "not_found");
  // The avatar session started (the invitation was consumed) but recording
  // the start failed; adopt the provider session id so nothing is lost.
  if (session.status === "DEVICE_CHECK" && input.providerSessionId && /^[A-Za-z0-9_-]{6,200}$/.test(input.providerSessionId)) {
    const invitation = await invitationByHash(hashToken(input.rawToken));
    if (invitation && invitation.tokenStatus !== "pending") {
      const [adopted] = await getDb().update(liveInterviewSessions).set({ status: "INTERVIEW_IN_PROGRESS", providerSessionId: input.providerSessionId, interviewStartedAt: session.deviceCheckAt ?? new Date(), recordingStatus: session.recordingConsent ? "failed" : "not_consented", recordingError: session.recordingConsent ? "Interview start was not recorded, so the recording could not be attached." : "", updatedAt: new Date() })
        .where(and(eq(liveInterviewSessions.id, session.id), eq(liveInterviewSessions.status, "DEVICE_CHECK"))).returning();
      session = adopted ?? session;
    }
  }
  if (PRE_INTERVIEW_STATUSES.includes(session.status as LiveInterviewStatus)) throw new LiveInterviewError("This interview has not started yet.", 409, "not_started");
  if (session.status !== "INTERVIEW_IN_PROGRESS") return { session, alreadyCompleted: true };
  await saveIntegrityEvents(session, sanitizeIntegrityEvents(input.integrityEvents));
  const transcript = sanitizeClientTranscript(input.transcript);
  const stored = Array.isArray(session.clientTranscript) ? session.clientTranscript.length : 0;
  const flags = input.interrupted
    ? addReviewFlag(session.reviewFlags, { code: "interview_interrupted", message: "The interview ended unexpectedly (disconnect, reload, or closed page) before the applicant finished." })
    : session.reviewFlags;
  const [updated] = await getDb().update(liveInterviewSessions).set({
    status: "INTERVIEW_COMPLETED",
    interviewCompletedAt: new Date(),
    ...(transcript.length >= stored && transcript.length > 0 ? { clientTranscript: transcript } : {}),
    reviewFlags: flags,
    needsHrReview: session.needsHrReview || Boolean(input.interrupted),
    updatedAt: new Date(),
  }).where(and(eq(liveInterviewSessions.id, session.id), eq(liveInterviewSessions.status, "INTERVIEW_IN_PROGRESS"))).returning();
  if (!updated) return { session: (await getSessionById(session.id)) ?? session, alreadyCompleted: true };
  await stopProviderSession(updated.providerSessionId);
  try {
    const [application] = await getDb().select({ externalId: applications.externalId, candidateName: applications.candidateName }).from(applications).where(eq(applications.id, updated.applicationId)).limit(1);
    await recordLiveAvatarInterviewDeduction({
      // The applicant who completed the interview is the actor on the ledger.
      actorName: application?.candidateName ? `${application.candidateName} (Applicant)` : "",
      applicationId: application?.externalId || updated.applicationId,
      sessionId: updated.id,
      organizationId: updated.organizationId,
      durationSeconds: updated.interviewStartedAt && updated.interviewCompletedAt ? (updated.interviewCompletedAt.getTime() - updated.interviewStartedAt.getTime()) / 1000 : null,
    });
  } catch (error) {
    // Never block interview completion on a billing failure; the ledger can
    // be reconciled after the fact from the session id.
    console.error("[Live Interview] Failed to record credit deduction:", { sessionId: updated.id, error: errorText(error) });
  }
  return { session: updated, alreadyCompleted: false };
}

// Startup rollback and normal completion both use the same provider cleanup
// path so a failed recording setup cannot leave an unused Avatar room running.
export async function stopProviderSession(providerSessionId: string) {
  const apiKey = process.env.LIVEAVATAR_API_KEY?.trim();
  if (!apiKey || !providerSessionId) return;
  try {
    await fetch(`${LIVEAVATAR_API_URL}/v1/sessions/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ session_id: providerSessionId }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    // Already-stopped sessions are expected here; log for diagnostics only.
    console.warn("[Live Interview] Provider stop request failed:", { providerSessionId, error: errorText(error) });
  }
}

// ---------------------------------------------------------------------------
// Processing pipeline: transcript -> application completion -> AI analysis
// ---------------------------------------------------------------------------

async function fetchProviderTranscript(providerSessionId: string): Promise<TranscriptTurn[]> {
  const apiKey = process.env.LIVEAVATAR_API_KEY?.trim();
  if (!apiKey) throw new Error("LIVEAVATAR_API_KEY is not configured.");
  if (!providerSessionId) throw new Error("The interview has no LiveAvatar session id.");
  let lastError: unknown = null;
  // LiveAvatar may take a few seconds to finalise the transcript after stop.
  for (const delayMs of [0, 2_000, 4_000, 6_000]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      const response = await fetch(`${LIVEAVATAR_API_URL}/v1/sessions/${encodeURIComponent(providerSessionId)}/transcript`, {
        headers: { "X-API-KEY": apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json().catch(() => ({})) as { data?: { transcript_data?: unknown; session_active?: boolean } };
      if (!response.ok) throw new Error(`LiveAvatar transcript request returned ${response.status}.`);
      const turns = normalizeProviderTranscript(body.data?.transcript_data);
      if (turns.length > 0) return turns;
      lastError = new Error("LiveAvatar returned an empty transcript.");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("LiveAvatar transcript unavailable.");
}

async function replaceTranscript(session: SessionRow, turns: TranscriptTurn[], source: "provider" | "client_capture" | "none") {
  await getDb().transaction(async (tx) => {
    await tx.delete(liveInterviewTranscriptTurns).where(eq(liveInterviewTranscriptTurns.sessionId, session.id));
    if (turns.length > 0) {
      await tx.insert(liveInterviewTranscriptTurns).values(turns.map((turn) => ({
        organizationId: session.organizationId,
        sessionId: session.id,
        seq: turn.seq,
        speaker: turn.speaker,
        text: turn.text,
        occurredAt: turn.occurredAt ? new Date(turn.occurredAt) : null,
        relativeMs: turn.relativeMs,
        questionIndex: turn.questionIndex,
        source: turn.source,
      })));
    }
    await tx.update(liveInterviewSessions).set({ transcriptSource: source, transcriptFetchedAt: new Date(), updatedAt: new Date() }).where(eq(liveInterviewSessions.id, session.id));
  });
}

async function storedTurns(sessionId: string): Promise<TranscriptTurn[]> {
  const rows = await getDb().select().from(liveInterviewTranscriptTurns).where(eq(liveInterviewTranscriptTurns.sessionId, sessionId)).orderBy(asc(liveInterviewTranscriptTurns.seq));
  return rows.map((row) => ({
    seq: row.seq,
    speaker: row.speaker === "applicant" ? "applicant" : "ai_interviewer",
    text: row.text,
    occurredAt: row.occurredAt ? row.occurredAt.toISOString() : null,
    relativeMs: row.relativeMs,
    questionIndex: row.questionIndex,
    source: row.source === "client_capture" ? "client_capture" : "provider",
  }));
}

async function roleContext(session: SessionRow) {
  const [row] = await getDb().select({ title: roles.title, setup: roles.setup }).from(roles).where(eq(roles.id, session.roleId)).limit(1);
  const setup = row?.setup && typeof row.setup === "object" ? row.setup as Record<string, unknown> : {};
  return {
    roleTitle: row?.title || "",
    jobDescription: String(setup.jobDescription || "").trim(),
    roleRequirements: buildRoleRequirementsContext(setup, row?.title || "").requirements,
  };
}

/** Same reference for the log line and the HR page, derived from the stored failure time. */
function failureReference(sessionId: string, at: Date | null) {
  return at ? errorReference(`${sessionId}:${at.toISOString()}`) : "";
}

/**
 * Records a failed processing step. The technical error goes to the server
 * log (with a reference) and the internal `last_error` column only; HR sees
 * fixed wording plus the reference. A non-terminal failure may hold the lease
 * for `retryAfterMs` so the next automatic attempt backs off.
 */
async function recordFailure(session: SessionRow, stage: string, error: unknown, terminal: boolean, retryAfterMs = 0) {
  const message = errorText(error);
  const at = new Date();
  const reference = failureReference(session.id, at);
  const classified = error instanceof InterviewAnalysisError ? error : null;
  logInternalError(stage === "analysis" ? "InterviewAnalysisError" : "LiveInterviewProcessingError", error, {
    sessionId: session.id,
    applicationId: session.applicationId,
    applicantId: session.applicantId,
    stage,
    attempt: session.processingAttempts,
    terminal,
    ...(classified ? { kind: classified.kind, retryable: classified.retryable, providerStatus: classified.providerStatus, providerRequestId: classified.providerRequestId } : {}),
    ...(retryAfterMs ? { nextAttemptInMs: retryAfterMs } : {}),
  }, reference);
  const current = await getSessionById(session.id);
  await getDb().update(liveInterviewSessions).set({
    ...(terminal ? { status: "FAILED" as LiveInterviewStatus, needsHrReview: true, reviewFlags: addReviewFlag(current?.reviewFlags, { code: `${stage}_failed`, message: `Automatic ${stage} could not be completed.` }) } : {}),
    failureStage: stage,
    lastError: message,
    lastErrorAt: at,
    processingLeaseUntil: retryAfterMs > 0 && !terminal ? new Date(at.getTime() + retryAfterMs) : null,
    updatedAt: at,
  }).where(eq(liveInterviewSessions.id, session.id));
}

/** Moves the application to HR review and links the voice result (idempotent). */
async function ensureApplicationCompleted(session: SessionRow, turns: TranscriptTurn[]) {
  if (session.voiceResultId) return;
  const [token] = await getDb().select({ tokenHash: bookingTokens.tokenHash }).from(bookingTokens).where(eq(bookingTokens.id, session.bookingTokenId)).limit(1);
  if (!token) throw new Error("The interview invitation no longer exists.");
  const providerTurns = turns.map((turn) => ({ role: turn.speaker === "applicant" ? "user" : "avatar", transcript: turn.text }));
  // No score yet: the rubric-based assessment replaces this placeholder once
  // the analysis finishes. The old keyword heuristic is deliberately unused.
  const evaluation = { score: null, answered: turns.some((turn) => turn.speaker === "applicant"), answer: "", summary: "", strengths: [] as string[], focusAreas: [] as string[], recommendation: "Awaiting AI Review" };
  const completed = await completeAvatarInterviewByHash({ tokenHash: token.tokenHash, sessionId: session.providerSessionId, evaluation, transcript: providerTurns });
  let voiceResultId = completed.completed ? completed.voiceResultId : "";
  if (!voiceResultId) {
    // Already completed by an earlier run: link the existing result instead.
    const [existing] = await getDb().select({ id: voiceInterviewResults.id }).from(voiceInterviewResults)
      .where(and(eq(voiceInterviewResults.applicationId, session.applicationId), eq(voiceInterviewResults.providerEventType, "live_avatar_interview")))
      .orderBy(desc(voiceInterviewResults.createdAt)).limit(1);
    voiceResultId = existing?.id || "";
  }
  if (voiceResultId) await getDb().update(liveInterviewSessions).set({ voiceResultId, updatedAt: new Date() }).where(eq(liveInterviewSessions.id, session.id));
}

function emptyAnalysis(summary: string, clarify: string): InterviewAnalysis {
  return { interviewSummary: summary, relevantExperience: [], skillsMentioned: [], strengthsEvidenced: [], areasToClarify: [{ topic: clarify, reason: "No applicant answers were captured in the transcript.", turnRefs: [] }], notableResponses: [], questionReviews: [] };
}

export type ProcessDeps = { analysisClient?: AnalysisClient; fetchTranscript?: (providerSessionId: string) => Promise<TranscriptTurn[]> };

export type ProcessResult = { claimed: boolean; session: SessionRow | null; retryAfterMs?: number };

/**
 * Runs whatever processing remains for a completed interview. Safe to call
 * concurrently and repeatedly: a lease admits one worker; finished stages are
 * skipped; results are only written once. A transient analysis failure
 * returns `retryAfterMs` (exponential backoff); a permanent one (invalid
 * request, authentication, exhausted quota) fails the analysis immediately
 * instead of burning the remaining attempts.
 */
export async function processLiveInterviewSession(sessionId: string, deps: ProcessDeps = {}): Promise<ProcessResult> {
  const now = new Date();
  const [claimed] = await getDb().update(liveInterviewSessions).set({
    processingLeaseUntil: new Date(now.getTime() + PROCESSING_LEASE_MS),
    processingAttempts: sql`${liveInterviewSessions.processingAttempts} + 1`,
    // Empty while a worker holds the lease; set again if this run fails.
    failureStage: "",
    updatedAt: now,
  }).where(and(
    eq(liveInterviewSessions.id, sessionId),
    inArray(liveInterviewSessions.status, PROCESSING_STATUSES),
    or(isNull(liveInterviewSessions.processingLeaseUntil), lt(liveInterviewSessions.processingLeaseUntil, now)),
    lt(liveInterviewSessions.processingAttempts, MAX_PROCESSING_ATTEMPTS),
  )).returning();
  if (!claimed) return { claimed: false as const, session: await getSessionById(sessionId) };
  const attempt = claimed.processingAttempts;
  const terminal = attempt >= MAX_PROCESSING_ATTEMPTS;
  let session = claimed;

  // Stage 1: transcript.
  let turns = session.transcriptSource ? await storedTurns(session.id) : [];
  // "none" = a previous run gave up on the transcript; an HR retry re-fetches it.
  if (!session.transcriptSource) {
    await getDb().update(liveInterviewSessions).set({ status: "TRANSCRIPTION_PROCESSING", updatedAt: new Date() }).where(eq(liveInterviewSessions.id, session.id));
    let providerError: unknown = null;
    try {
      turns = await (deps.fetchTranscript || fetchProviderTranscript)(session.providerSessionId);
    } catch (error) {
      providerError = error;
      turns = [];
    }
    let source: "provider" | "client_capture" = "provider";
    if (turns.length === 0) {
      const clientTurns = normalizeClientTranscript(sanitizeClientTranscript(session.clientTranscript) as ClientTranscriptEvent[]);
      const mayFallBack = attempt >= PROVIDER_TRANSCRIPT_ATTEMPTS_BEFORE_FALLBACK || !session.providerSessionId;
      if (clientTurns.length > 0 && mayFallBack) {
        turns = clientTurns;
        source = "client_capture";
        console.warn("[Live Interview] Using browser-captured transcript:", { sessionId, providerError: errorText(providerError) });
      } else if (!terminal) {
        await recordFailure(session, "transcription", providerError || new Error("No transcript available yet."), false);
        return { claimed: true as const, session: await getSessionById(session.id) };
      }
    }
    await replaceTranscript(session, turns, turns.length === 0 ? "none" : source);
    if (source === "client_capture" || turns.length === 0) {
      const flag: ReviewFlag = turns.length === 0
        ? { code: "no_transcript", message: "No transcript could be retrieved for this interview." }
        : { code: "transcript_from_browser", message: "The provider transcript was unavailable; this transcript was captured in the applicant's browser and may be incomplete." };
      await getDb().update(liveInterviewSessions).set({ reviewFlags: addReviewFlag(session.reviewFlags, flag), needsHrReview: true, lastError: errorText(providerError || ""), lastErrorAt: providerError ? new Date() : null }).where(eq(liveInterviewSessions.id, session.id));
    }
    session = (await getSessionById(session.id)) ?? session;
  }

  // Stage 2: application moves to HR review (even with no transcript).
  try {
    await ensureApplicationCompleted(session, turns);
  } catch (error) {
    await recordFailure(session, "completion", error, terminal);
    return { claimed: true as const, session: await getSessionById(session.id) };
  }
  if (turns.length === 0) {
    await recordFailure(session, "transcription", new Error("No transcript could be retrieved from LiveAvatar or the browser capture."), true);
    return { claimed: true as const, session: await getSessionById(session.id) };
  }

  // Stage 3: AI analysis and rubric assessment.
  session = (await getSessionById(session.id)) ?? session;
  if (session.analysis) {
    await getDb().update(liveInterviewSessions).set({ status: "REVIEW_READY", processingLeaseUntil: null, updatedAt: new Date() }).where(eq(liveInterviewSessions.id, session.id));
    return { claimed: true as const, session: await getSessionById(session.id) };
  }
  await getDb().update(liveInterviewSessions).set({ status: "ANALYSIS_PROCESSING", updatedAt: new Date() }).where(eq(liveInterviewSessions.id, session.id));
  const pairs = buildQuestionPairs(turns);
  const interrupted = Array.isArray(session.reviewFlags) && (session.reviewFlags as ReviewFlag[]).some((flag) => flag.code === "interview_interrupted");
  let analysis: InterviewAnalysis;
  let assessment: InterviewAssessment;
  let model = "";
  if (!turns.some((turn) => turn.speaker === "applicant")) {
    analysis = emptyAnalysis("The transcript contains no spoken answers from the applicant.", "Whether the applicant was able to answer the interview questions");
    assessment = computeAssessment({ pairs, reviews: [], transcriptSource: session.transcriptSource, interrupted });
    model = "none";
  } else {
    if (!deps.analysisClient && !isInterviewAnalysisConfigured()) {
      await recordFailure(session, "analysis", new InterviewAnalysisError("AI interview analysis is not configured (INTERVIEW_ANALYSIS_OPENAI_API_KEY or OPENAI_API_KEY is missing).", "not_configured"), true);
      return { claimed: true as const, session: await getSessionById(session.id) };
    }
    try {
      const role = await roleContext(session);
      // The SDK retries only transient failures (connection, 408/409/429/5xx)
      // with its own backoff; a 400 is never retried here.
      const client = deps.analysisClient || (new OpenAI({ apiKey: interviewAnalysisApiKey(), maxRetries: 2 }) as unknown as AnalysisClient);
      // The model rates a blinded copy (no name/email/phone); the stored and
      // displayed transcript stays unredacted for HR.
      const [application] = await getDb().select({ candidateName: applications.candidateName }).from(applications).where(eq(applications.id, session.applicationId)).limit(1);
      const blindTurns = redactApplicantIdentity(turns, [application?.candidateName || ""]);
      const blindPairs = buildQuestionPairs(blindTurns);
      const result = await analyzeInterviewTranscript(client, { ...role, turns: blindTurns, pairs: blindPairs });
      analysis = result.analysis;
      assessment = computeAssessment({ pairs: blindPairs, reviews: result.analysis.questionReviews, transcriptSource: session.transcriptSource, interrupted });
      model = result.model;
    } catch (error) {
      const classified = classifyAnalysisError(error);
      const final = terminal || !classified.retryable;
      const retryAfterMs = final ? 0 : analysisRetryDelayMs(attempt);
      await recordFailure(session, "analysis", classified, final, retryAfterMs);
      return { claimed: true as const, session: await getSessionById(session.id), ...(retryAfterMs ? { retryAfterMs } : {}) };
    }
  }
  const stored: StoredInterviewAnalysis = { ...analysis, assessment };
  const unscored = assessment.status !== "scored";
  // A successful (re)run clears the earlier analysis-failure flag.
  const flags = removeReviewFlag(session.reviewFlags, "analysis_failed");
  const [written] = await getDb().update(liveInterviewSessions).set({
    analysis: stored,
    analysisModel: model,
    analysisCompletedAt: new Date(),
    status: "REVIEW_READY",
    processingLeaseUntil: null,
    failureStage: "",
    reviewFlags: unscored ? addReviewFlag(flags, { code: "not_scored", message: `${NOT_SCORED_LABEL}: ${assessment.notScoredReason}` }) : flags,
    ...(unscored ? { needsHrReview: true } : {}),
    updatedAt: new Date(),
  }).where(and(eq(liveInterviewSessions.id, session.id), isNull(liveInterviewSessions.analysis))).returning({ id: liveInterviewSessions.id });
  // Keep the shared voice-review fields (score, recommendation, strengths,
  // concerns, summary) consistent with the assessment. Written only by the
  // run that stored the analysis, so retries and duplicates cannot overwrite it.
  if (written && session.voiceResultId) {
    await getDb().update(voiceInterviewResults).set({
      score: assessment.score,
      recommendation: assessment.bandLabel,
      strengths: stored.strengthsEvidenced.map((item) => item.strength).join("; "),
      concerns: stored.areasToClarify.map((item) => item.topic).join("; "),
      summary: stored.interviewSummary,
      evaluationScores: assessment as unknown as object,
    }).where(eq(voiceInterviewResults.id, session.voiceResultId));
  }
  return { claimed: true as const, session: await getSessionById(session.id) };
}

/**
 * Runs processing passes within a time budget, waiting out short backoffs
 * between transient failures. Used after the interview completes and after
 * an HR retry; anything left over is resumed by the recovery sweep.
 */
export async function runLiveInterviewProcessing(sessionId: string, options: { budgetMs?: number; maxPasses?: number } = {}) {
  // A pass can take ~100 s (transcript fetch + 90 s analysis timeout), so no
  // new pass starts after this point to stay inside a 300 s function.
  const deadline = Date.now() + (options.budgetMs ?? 150_000);
  let result: ProcessResult | null = null;
  for (let pass = 0; pass < (options.maxPasses ?? 3); pass += 1) {
    result = await processLiveInterviewSession(sessionId);
    if (!result.claimed || !PROCESSING_STATUSES.includes((result.session?.status || "") as LiveInterviewStatus)) break;
    const wait = result.retryAfterMs ?? 0;
    if (Date.now() + wait + 5_000 > deadline) break;
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  return result;
}

/**
 * HR "retry analysis" after a failure or stall. Resets only the processing
 * bookkeeping: the transcript, recording, consent, timestamps, and HR notes
 * are untouched; the transcript is re-fetched only if none was ever stored.
 * Refuses (started: false) while a worker holds the lease, so repeated clicks
 * or a second tab cannot start duplicate processing; the analysis itself is
 * written at most once (guarded by `analysis IS NULL`).
 */
export async function requestLiveInterviewRetry(sessionId: string): Promise<{ started: boolean; session: SessionRow | null }> {
  const session = await getSessionById(sessionId);
  if (!session) return { started: false, session: null };
  if (session.analysis || !["FAILED", ...PROCESSING_STATUSES].includes(session.status)) return { started: false, session };
  const refetchTranscript = !session.transcriptSource || session.transcriptSource === "none";
  const now = new Date();
  const [updated] = await getDb().update(liveInterviewSessions).set({
    status: refetchTranscript ? "TRANSCRIPTION_PROCESSING" : "ANALYSIS_PROCESSING",
    ...(refetchTranscript ? { transcriptSource: "" } : {}),
    processingAttempts: 0,
    processingLeaseUntil: null,
    failureStage: "",
    updatedAt: now,
  }).where(and(
    eq(liveInterviewSessions.id, session.id),
    isNull(liveInterviewSessions.analysis),
    or(
      eq(liveInterviewSessions.status, "FAILED"),
      and(
        inArray(liveInterviewSessions.status, PROCESSING_STATUSES),
        // Idle, stalled, or waiting out a backoff — never an active worker.
        or(isNull(liveInterviewSessions.processingLeaseUntil), lt(liveInterviewSessions.processingLeaseUntil, now), sql`${liveInterviewSessions.failureStage} <> ''`),
      ),
    ),
  )).returning();
  return { started: Boolean(updated), session: updated ?? (await getSessionById(session.id)) };
}

/**
 * Recovery sweep (cron + lazily from HR review): completes abandoned
 * in-progress interviews and resumes processing whose worker died.
 */
export async function recoverStaleLiveInterviews(options: { limit?: number; sessionId?: string } = {}) {
  const db = getDb();
  const now = Date.now();
  const scope = options.sessionId ? eq(liveInterviewSessions.id, options.sessionId) : undefined;
  const abandoned = await db.select().from(liveInterviewSessions).where(and(
    eq(liveInterviewSessions.status, "INTERVIEW_IN_PROGRESS"),
    lt(liveInterviewSessions.interviewStartedAt, new Date(now - STALE_IN_PROGRESS_MS)),
    scope,
  )).limit(options.limit ?? 10);
  for (const session of abandoned) {
    await db.update(liveInterviewSessions).set({
      status: "INTERVIEW_COMPLETED",
      interviewCompletedAt: new Date(),
      needsHrReview: true,
      reviewFlags: addReviewFlag(session.reviewFlags, { code: "interview_interrupted", message: "The interview was not finished in the applicant's browser; it was closed automatically and saved for review." }),
      updatedAt: new Date(),
    }).where(and(eq(liveInterviewSessions.id, session.id), eq(liveInterviewSessions.status, "INTERVIEW_IN_PROGRESS")));
  }
  const recordings = await finalizeStaleRecordings(options);
  const pending = await db.select({ id: liveInterviewSessions.id }).from(liveInterviewSessions).where(and(
    inArray(liveInterviewSessions.status, PROCESSING_STATUSES),
    or(isNull(liveInterviewSessions.processingLeaseUntil), lt(liveInterviewSessions.processingLeaseUntil, new Date(now))),
    lt(liveInterviewSessions.processingAttempts, MAX_PROCESSING_ATTEMPTS),
    scope,
  )).orderBy(asc(liveInterviewSessions.updatedAt)).limit(options.limit ?? 5);
  const results = [];
  for (const { id } of pending) {
    const result = await processLiveInterviewSession(id);
    results.push({ id, claimed: result.claimed, status: result.session?.status || "" });
  }
  return { closedAbandoned: abandoned.length, recordings, processed: results };
}

const STALE_RECORDING_MS = 30 * 60 * 1000;

/**
 * A browser that closed mid-upload never sends the final chunk. Close the
 * Drive upload with the bytes already received (a truncated but playable
 * recording), or mark the recording failed when nothing arrived.
 */
async function finalizeStaleRecordings(options: { limit?: number; sessionId?: string }) {
  const db = getDb();
  const stale = await db.select().from(liveInterviewSessions).where(and(
    inArray(liveInterviewSessions.recordingStatus, ["pending", "uploading"]),
    inArray(liveInterviewSessions.status, ["INTERVIEW_COMPLETED", "TRANSCRIPTION_PROCESSING", "ANALYSIS_PROCESSING", "REVIEW_READY", "FAILED"]),
    lt(liveInterviewSessions.updatedAt, new Date(Date.now() - STALE_RECORDING_MS)),
    options.sessionId ? eq(liveInterviewSessions.id, options.sessionId) : undefined,
  )).limit(options.limit ?? 10);
  let finalized = 0;
  for (const session of stale) {
    const markFailed = async (reason: string) => {
      console.error("[Live Interview] Stale recording closed as failed:", { sessionId: session.id, reason });
      await db.update(liveInterviewSessions).set({
        recordingStatus: "failed",
        recordingError: reason,
        recordingUploadUrl: "",
        needsHrReview: true,
        reviewFlags: addReviewFlag(session.reviewFlags, { code: "recording_failed", message: "The interview recording is not available." }),
        updatedAt: new Date(),
      }).where(eq(liveInterviewSessions.id, session.id));
    };
    if (!session.recordingUploadUrl || session.recordingBytes === 0) {
      await markFailed("No recording data was received from the applicant's browser.");
      continue;
    }
    try {
      const result = await uploadRecordingChunk(session.recordingUploadUrl, new Uint8Array(0), session.recordingBytes, true);
      if (!result.complete) throw new Error("Drive did not close the upload.");
      await db.update(liveInterviewSessions).set({
        recordingStatus: "available",
        recordingStorageRef: result.fileId,
        recordingBytes: result.receivedBytes,
        recordingUploadUrl: "",
        needsHrReview: true,
        reviewFlags: addReviewFlag(session.reviewFlags, { code: "recording_partial", message: "The recording upload was interrupted; the saved recording may end early." }),
        updatedAt: new Date(),
      }).where(eq(liveInterviewSessions.id, session.id));
      finalized += 1;
    } catch (error) {
      logInternalError("LiveInterviewRecordingError", error, { sessionId: session.id, stage: "finalize_partial_recording" });
      await markFailed("The partial recording could not be saved.");
    }
  }
  return { checked: stale.length, finalized };
}

// ---------------------------------------------------------------------------
// Recording upload (browser -> portal -> private Drive resumable upload)
// ---------------------------------------------------------------------------

async function recordingSession(rawToken: string) {
  const session = await getSessionByToken(rawToken);
  if (!session || !session.recordingConsent) throw new LiveInterviewError("Recording is not enabled for this interview.", 403, "recording_not_consented");
  if (Date.now() - session.createdAt.getTime() > RECORDING_UPLOAD_WINDOW_MS) throw new LiveInterviewError("The recording upload window has closed.", 410, "recording_window_closed");
  if (!["pending", "uploading"].includes(session.recordingStatus)) throw new LiveInterviewError("This recording is no longer accepting uploads.", 409, "recording_closed");
  return session;
}

export async function receiveRecordingChunk(input: { rawToken: string; offset: number; final: boolean; mimeType: string; chunk: Uint8Array }) {
  let session = await recordingSession(input.rawToken);
  if (!Number.isSafeInteger(input.offset) || input.offset < 0) throw new LiveInterviewError("Invalid recording offset.", 400, "invalid_offset");
  if (input.offset + input.chunk.byteLength > MAX_RECORDING_BYTES) throw new LiveInterviewError("The recording is larger than the allowed maximum.", 413, "recording_too_large");
  // A retried chunk the server already forwarded is acknowledged, not resent.
  if (input.offset < session.recordingBytes && !input.final) return { receivedBytes: session.recordingBytes, complete: false };
  if (input.offset !== session.recordingBytes) throw new LiveInterviewError(`Expected recording offset ${session.recordingBytes}.`, 409, "offset_mismatch");
  const db = getDb();
  if (!session.recordingUploadUrl) {
    if (!isAllowedRecordingMimeType(input.mimeType)) throw new LiveInterviewError("Unsupported recording format.", 415, "unsupported_media");
    const upload = await beginRecordingUpload({ organizationId: session.organizationId, sessionId: session.id, mimeType: input.mimeType });
    const [claimed] = await db.update(liveInterviewSessions).set({ recordingUploadUrl: upload.uploadUrl, recordingStorageAccountEmail: upload.accountEmail, recordingStatus: "uploading", recordingMimeType: input.mimeType.split(";")[0].trim(), updatedAt: new Date() })
      .where(and(eq(liveInterviewSessions.id, session.id), eq(liveInterviewSessions.recordingUploadUrl, ""))).returning();
    session = claimed ?? (await getSessionById(session.id)) ?? session;
  }
  const result = await uploadRecordingChunk(session.recordingUploadUrl, input.chunk, input.offset, input.final);
  if (result.complete) {
    if (result.receivedBytes <= 0) {
      await markRecordingFailed({ rawToken: input.rawToken, reason: "No recording data was received from the applicant's browser." });
      throw new LiveInterviewError("No recording data was received from the applicant's browser.", 502, "recording_empty");
    }
    await db.update(liveInterviewSessions).set({ recordingStatus: "available", recordingStorageRef: result.fileId, recordingBytes: result.receivedBytes, recordingUploadUrl: "", recordingError: "", updatedAt: new Date() }).where(eq(liveInterviewSessions.id, session.id));
  } else {
    await db.update(liveInterviewSessions).set({ recordingBytes: result.receivedBytes, updatedAt: new Date() }).where(eq(liveInterviewSessions.id, session.id));
  }
  return { receivedBytes: result.receivedBytes, complete: result.complete };
}

/** Records a recording failure honestly; the interview itself is unaffected. */
export async function markRecordingFailed(input: { rawToken: string; reason: string }) {
  const session = await getSessionByToken(input.rawToken);
  if (!session || !session.recordingConsent || session.recordingStatus === "available") return false;
  const reason = input.reason.replace(/\s+/g, " ").trim().slice(0, 500) || "The browser could not record the interview.";
  console.error("[Live Interview] Recording failed:", { sessionId: session.id, reason });
  await getDb().update(liveInterviewSessions).set({
    recordingStatus: "failed",
    recordingError: reason,
    recordingUploadUrl: "",
    needsHrReview: true,
    reviewFlags: addReviewFlag(session.reviewFlags, { code: "recording_failed", message: "The interview recording is not available." }),
    updatedAt: new Date(),
  }).where(eq(liveInterviewSessions.id, session.id));
  return true;
}

// ---------------------------------------------------------------------------
// HR review read model (never includes upload URLs, prompts, credentials, or
// raw provider/database errors — only fixed wording and an error reference)
// ---------------------------------------------------------------------------

export type LiveInterviewReview = {
  sessionId: string;
  applicationId: string;
  applicantName: string;
  roleTitle: string;
  status: LiveInterviewStatus;
  interviewState: InterviewState;
  analysisState: AnalysisState;
  interviewDate: string;
  durationSeconds: number | null;
  consent: { given: boolean; version: string; at: string; recording: boolean; camera: boolean; microphone: boolean };
  recording: { status: string; available: boolean };
  transcriptSource: string;
  turns: TranscriptTurn[];
  questions: ReturnType<typeof buildQuestionPairs>;
  analysis: StoredInterviewAnalysis | null;
  analysisCompletedAt: string;
  failureStage: string;
  /** Matches the server log entry for the latest failure; empty when none. */
  errorReference: string;
  processingAttempts: number;
  maxProcessingAttempts: number;
  needsHrReview: boolean;
  reviewFlags: ReviewFlag[];
  integrityEvents: { type: string; at: string; detail: string }[];
};

/** Fixed, user-safe fields for unresolved Drive recording uploads on HR's dashboard. */
export async function listDashboardRecordingFailures(organizationId: string, limit = 6) {
  const rows = await getDb().select({
    applicationId: applications.externalId,
    candidateName: applications.candidateName,
    updatedAt: liveInterviewSessions.updatedAt,
  }).from(liveInterviewSessions)
    .innerJoin(applications, eq(applications.id, liveInterviewSessions.applicationId))
    .where(and(
      eq(liveInterviewSessions.organizationId, organizationId.trim()),
      eq(liveInterviewSessions.recordingStatus, "failed"),
      eq(applications.withdrawn, false),
    ))
    .orderBy(desc(liveInterviewSessions.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 20));
  return rows.map((row) => ({ applicationId: row.applicationId, candidateName: row.candidateName, updatedAt: row.updatedAt?.toISOString() || "" }));
}

/** Live Avatar interviews whose transcript or analysis gave up after every retry; HR must retry them. */
export async function listDashboardProcessingFailures(organizationId: string, limit = 6) {
  const rows = await getDb().select({
    applicationId: applications.externalId,
    candidateName: applications.candidateName,
    updatedAt: liveInterviewSessions.updatedAt,
  }).from(liveInterviewSessions)
    .innerJoin(applications, eq(applications.id, liveInterviewSessions.applicationId))
    .where(and(
      eq(liveInterviewSessions.organizationId, organizationId.trim()),
      eq(liveInterviewSessions.status, "FAILED"),
      eq(applications.withdrawn, false),
    ))
    .orderBy(desc(liveInterviewSessions.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 20));
  return rows.map((row) => ({ applicationId: row.applicationId, candidateName: row.candidateName, updatedAt: row.updatedAt?.toISOString() || "" }));
}

/** Loads the latest live interview for an application in the caller's organization. */
export async function getLiveInterviewReview(applicationExternalId: string, organizationId: string): Promise<LiveInterviewReview | null> {
  const db = getDb();
  const org = organizationId || DEFAULT_ORGANIZATION_ID;
  const [row] = await db.select({ session: liveInterviewSessions, applicationExternalId: applications.externalId, candidateName: applications.candidateName, applicantName: applicants.fullName, roleTitle: roles.title })
    .from(liveInterviewSessions)
    .innerJoin(applications, eq(applications.id, liveInterviewSessions.applicationId))
    .innerJoin(applicants, eq(applicants.id, liveInterviewSessions.applicantId))
    .innerJoin(roles, eq(roles.id, liveInterviewSessions.roleId))
    .where(and(eq(applications.externalId, applicationExternalId), eq(liveInterviewSessions.organizationId, org)))
    .orderBy(desc(liveInterviewSessions.createdAt))
    .limit(1);
  if (!row) return null;
  const session = row.session;
  const [turns, events] = await Promise.all([
    storedTurns(session.id),
    db.select().from(liveInterviewIntegrityEvents).where(eq(liveInterviewIntegrityEvents.sessionId, session.id)).orderBy(asc(liveInterviewIntegrityEvents.occurredAt)).limit(MAX_INTEGRITY_EVENTS_PER_SESSION),
  ]);
  const started = session.interviewStartedAt?.getTime() ?? null;
  const completed = session.interviewCompletedAt?.getTime() ?? null;
  const status = session.status as LiveInterviewStatus;
  const analysisState = deriveAnalysisState(status, Boolean(session.analysis));
  return {
    sessionId: session.id,
    applicationId: row.applicationExternalId,
    applicantName: row.candidateName || row.applicantName || "",
    roleTitle: row.roleTitle,
    status,
    interviewState: deriveInterviewState(status),
    analysisState,
    interviewDate: (session.interviewStartedAt || session.createdAt).toISOString(),
    durationSeconds: started !== null && completed !== null ? Math.max(0, Math.round((completed - started) / 1000)) : transcriptDurationSeconds(turns),
    consent: {
      given: session.consentGiven,
      version: session.consentVersion,
      at: session.consentAt?.toISOString() || "",
      recording: session.recordingConsent,
      camera: session.cameraConsent,
      microphone: session.microphoneConsent,
    },
    recording: { status: session.recordingStatus, available: session.recordingStatus === "available" && Boolean(session.recordingStorageRef) },
    transcriptSource: session.transcriptSource,
    turns,
    questions: buildQuestionPairs(turns),
    analysis: (session.analysis as StoredInterviewAnalysis | null) ?? null,
    analysisCompletedAt: session.analysisCompletedAt?.toISOString() || "",
    failureStage: session.failureStage,
    errorReference: analysisState === "failed" || session.failureStage ? failureReference(session.id, session.lastErrorAt) : "",
    processingAttempts: session.processingAttempts,
    maxProcessingAttempts: MAX_PROCESSING_ATTEMPTS,
    needsHrReview: session.needsHrReview,
    reviewFlags: safeReviewFlags(session.reviewFlags),
    integrityEvents: events.map((event) => ({ type: event.eventType, at: event.occurredAt.toISOString(), detail: event.detail })),
  };
}

/** Recording reference for authenticated HR playback, scoped to the organization. */
export async function getLiveInterviewRecordingRef(applicationExternalId: string, organizationId: string) {
  const [row] = await getDb().select({ ref: liveInterviewSessions.recordingStorageRef, status: liveInterviewSessions.recordingStatus, mimeType: liveInterviewSessions.recordingMimeType, organizationId: liveInterviewSessions.organizationId, accountEmail: liveInterviewSessions.recordingStorageAccountEmail })
    .from(liveInterviewSessions)
    .innerJoin(applications, eq(applications.id, liveInterviewSessions.applicationId))
    .where(and(eq(applications.externalId, applicationExternalId), eq(liveInterviewSessions.organizationId, organizationId || DEFAULT_ORGANIZATION_ID)))
    .orderBy(desc(liveInterviewSessions.createdAt))
    .limit(1);
  if (!row || row.status !== "available" || !row.ref) return null;
  return { fileId: row.ref, mimeType: row.mimeType || "video/webm", organizationId: row.organizationId, accountEmail: row.accountEmail };
}

/** Candidate-safe status for the invitation page (no transcript, no analysis). */
export async function getCandidateInterviewStatus(rawToken: string) {
  const session = await getSessionByToken(rawToken);
  if (!session) return null;
  return { status: session.status as LiveInterviewStatus, completedAt: session.interviewCompletedAt?.toISOString() || "" };
}

/** Days an interview recording is kept before deletion. 0 (or a negative value) keeps recordings until the applicant is deleted. */
export function interviewRecordingRetentionDays() {
  const raw = process.env.INTERVIEW_RECORDING_RETENTION_DAYS?.trim();
  if (!raw) return 90;
  const days = Number.parseInt(raw, 10);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

/**
 * Deletes recordings older than the retention period from Drive. The
 * transcript, scores and HR decision stay on the applicant record; only the
 * video is removed. A failed Drive delete keeps the row so the next run retries.
 */
export async function purgeExpiredInterviewRecordings(options: { limit?: number } = {}) {
  const days = interviewRecordingRetentionDays();
  if (days === 0) return { purged: 0, failed: 0, skipped: "retention_disabled" as const };
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const db = getDb();
  const expired = await db.select({ id: liveInterviewSessions.id, ref: liveInterviewSessions.recordingStorageRef, organizationId: liveInterviewSessions.organizationId, accountEmail: liveInterviewSessions.recordingStorageAccountEmail }).from(liveInterviewSessions).where(and(
    eq(liveInterviewSessions.recordingStatus, "available"),
    lt(liveInterviewSessions.interviewCompletedAt, cutoff),
    sql`${liveInterviewSessions.recordingStorageRef} <> ''`,
  )).limit(options.limit ?? 25);
  let purged = 0;
  let failed = 0;
  for (const row of expired) {
    try {
      await deleteInterviewRecording(row.ref, row.organizationId, row.accountEmail);
      await db.update(liveInterviewSessions).set({ recordingStatus: "deleted", recordingStorageRef: "", recordingUploadUrl: "", recordingError: "", updatedAt: new Date() }).where(eq(liveInterviewSessions.id, row.id));
      if (row.accountEmail) await deleteRecordingDriveConnectionIfUnused(row.organizationId, row.accountEmail);
      purged += 1;
    } catch (error) {
      failed += 1;
      console.error("[Live Interview] Recording retention delete failed:", { sessionId: row.id, error: errorText(error) });
    }
  }
  return { purged, failed };
}
