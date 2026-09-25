// Interview analysis: structured output, failure classification, retry
// policy, separated interview/analysis states, and client-safe errors.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  analysisRetryDelayMs,
  ANALYSIS_STATE_LABELS,
  buildQuestionPairs,
  deriveAnalysisState,
  deriveInterviewState,
  INTERVIEW_STATE_LABELS,
  LIVE_INTERVIEW_STATUSES,
  normalizeProviderTranscript,
  processingFailureMessage,
  removeReviewFlag,
  safeReviewFlags,
  sanitizeInterviewAnalysis,
} from "../src/lib/live-interview.ts";
import {
  analyzeInterviewTranscript,
  buildAnalysisRequest,
  classifyAnalysisError,
  INTERVIEW_ANALYSIS_JSON_SCHEMA,
  InterviewAnalysisError,
  supportsTemperature,
} from "../src/lib/live-interview-analysis.ts";
import { clientErrorMessage, looksTechnical } from "../src/lib/client-error.ts";
import { errorReference, publicErrorMessage, safeErrorResponse } from "../src/lib/safe-error.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const quiet = async (fn) => { const original = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = original; } };

// A completed LiveAvatar (HeyGen) session transcript, as the provider returns it.
const heygenTranscript = [
  { role: "avatar", transcript: "Hello, thanks for joining this interview for the Customer Support role.", absolute_timestamp: 1_790_000_000, relative_timestamp: 0 },
  { role: "avatar", transcript: "Can you describe a time you resolved a difficult customer complaint?", absolute_timestamp: 1_790_000_006, relative_timestamp: 6 },
  { role: "user", transcript: "At my last job a customer was double billed, so I checked the invoice history, issued a refund the same day, and the customer renewed their contract.", absolute_timestamp: 1_790_000_015, relative_timestamp: 15 },
  { role: "avatar", transcript: "How do you prioritise when many tickets arrive at the same time?", absolute_timestamp: 1_790_000_030, relative_timestamp: 30 },
  { role: "user", transcript: "I sort tickets by severity and service level, answer outages first, and send a holding reply to everyone else within an hour.", absolute_timestamp: 1_790_000_040, relative_timestamp: 40 },
  { role: "avatar", transcript: "Thank you, that is the end of the interview.", absolute_timestamp: 1_790_000_055, relative_timestamp: 55 },
];
const turns = normalizeProviderTranscript(heygenTranscript);
const pairs = buildQuestionPairs(turns);
const input = { roleTitle: "Customer Support", jobDescription: "Resolve customer issues by email and phone.", turns, pairs };

const validOutput = () => ({
  interviewSummary: "The applicant described resolving a billing complaint with a same-day refund. They explained prioritising tickets by severity.",
  relevantExperience: [{ point: "Billing complaint resolution", evidence: "issued a refund the same day", turnRefs: [3] }],
  skillsMentioned: [{ skill: "Ticket triage", evidence: "sort tickets by severity and service level", turnRefs: [5] }],
  strengthsEvidenced: [{ strength: "Outcome focus", evidence: "the customer renewed their contract", turnRefs: [3] }],
  areasToClarify: [{ topic: "Escalation", reason: "Did not describe escalation paths.", turnRefs: [] }],
  notableResponses: [],
  questionReviews: [
    { questionIndex: pairs[0].questionIndex, rating: 4, analysis: "Specific example with an outcome.", jobCriteria: "Complaint handling", evidence: "issued a refund the same day" },
    { questionIndex: pairs[1].questionIndex, rating: 3, analysis: "Describes a concrete method.", jobCriteria: "Prioritisation", evidence: "answer outages first" },
  ],
});

const clientReturning = (output, record = {}) => ({ responses: { create: async (params) => { record.params = params; return { output_text: typeof output === "string" ? output : JSON.stringify(output) }; } } });
const clientThrowing = (error) => ({ responses: { create: async () => { throw error; } } });
const apiError = (status, message, extra = {}) => Object.assign(new Error(message), { status, name: "APIError", requestID: "req_test_123", ...extra });

// A / B -----------------------------------------------------------------------
test("A: a valid transcript produces a stored-shape analysis", async () => {
  const { analysis, model } = await analyzeInterviewTranscript(clientReturning(validOutput()), input);
  assert.ok(model);
  assert.match(analysis.interviewSummary, /billing complaint/);
  assert.equal(analysis.questionReviews.length, 2);
  assert.deepEqual(analysis.questionReviews.map((item) => item.rating), [4, 3]);
  assert.deepEqual(analysis.relevantExperience[0].turnRefs, [3]);
});

test("B: the request uses a strict JSON schema matching every field the portal stores", async () => {
  const record = {};
  await analyzeInterviewTranscript(clientReturning(validOutput(), record), input);
  const format = record.params.text.format;
  assert.equal(format.type, "json_schema");
  assert.equal(format.strict, true);
  assert.notEqual(format.type, "json_object", "json_object requires the word 'json' in the input messages (root cause of the 400)");
  const schema = INTERVIEW_ANALYSIS_JSON_SCHEMA;
  const keys = ["interviewSummary", "relevantExperience", "skillsMentioned", "strengthsEvidenced", "areasToClarify", "notableResponses", "questionReviews"];
  assert.deepEqual(schema.required, keys);
  assert.equal(schema.additionalProperties, false);
  // Strict mode requires every object to list all properties and forbid extras.
  const walk = (node) => {
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      Object.values(node.properties).forEach(walk);
    }
    if (node.type === "array") walk(node.items);
  };
  walk(schema);
  assert.deepEqual(schema.properties.questionReviews.items.properties.rating.enum, [0, 1, 2, 3, 4]);
  assert.match(record.params.input[0].content, /JSON/, "the user message also asks for JSON");
  assert.equal(record.params.temperature, 0.1);
});

test("B: reasoning models are not sent a temperature they would reject", () => {
  assert.equal(supportsTemperature("gpt-4o-mini"), true);
  for (const model of ["gpt-5-mini", "gpt-5", "o3", "o4-mini"]) assert.equal(supportsTemperature(model), false, model);
  assert.equal("temperature" in buildAnalysisRequest("gpt-5-mini", input), false);
});

// C ---------------------------------------------------------------------------
test("C: malformed model output is a retryable invalid_output error, not a crash", async () => {
  for (const output of ["not json", "", "{\"questionReviews\": \"nope\"}"]) {
    await assert.rejects(analyzeInterviewTranscript(clientReturning(output), input), (error) => {
      assert.ok(error instanceof InterviewAnalysisError);
      assert.equal(error.kind, "invalid_output");
      assert.equal(error.retryable, true);
      return true;
    });
  }
  const incomplete = { responses: { create: async () => ({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "{" }) } };
  await assert.rejects(analyzeInterviewTranscript(incomplete, input), (error) => error.kind === "invalid_output");
});

test("C: untidy but well-typed output is cleaned instead of discarding the analysis", () => {
  const output = validOutput();
  output.skillsMentioned.push({ skill: "   ", evidence: "", turnRefs: [0, -1, 5] });
  output.relevantExperience = Array.from({ length: 15 }, (_, index) => ({ point: `Point ${index}`, evidence: "x".repeat(5000), turnRefs: [3] }));
  const result = sanitizeInterviewAnalysis(output, { pairs, maxSeq: turns.length });
  assert.equal(result.skillsMentioned.length, 1, "blank item dropped");
  assert.equal(result.relevantExperience.length, 10, "extra items trimmed");
  assert.ok(result.relevantExperience[0].evidence.length <= 1200, "long text clamped");
});

// D / E / F / G -----------------------------------------------------------------
test("D: provider HTTP 400 is permanent and fails fast", async () => {
  const error = apiError(400, "400 Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'.");
  await assert.rejects(analyzeInterviewTranscript(clientThrowing(error), input), (caught) => {
    assert.equal(caught.kind, "provider_rejected");
    assert.equal(caught.retryable, false);
    assert.equal(caught.providerStatus, 400);
    assert.equal(caught.providerRequestId, "req_test_123");
    return true;
  });
  for (const status of [401, 403]) assert.equal(classifyAnalysisError(apiError(status, "auth")).retryable, false);
  assert.equal(classifyAnalysisError(apiError(404, "model not found")).retryable, false);
  assert.equal(classifyAnalysisError(apiError(422, "unprocessable")).retryable, false);
});

test("E: HTTP 429 rate limits are retryable; an exhausted quota is not", () => {
  const limited = classifyAnalysisError(apiError(429, "Rate limit reached"));
  assert.equal(limited.kind, "rate_limited");
  assert.equal(limited.retryable, true);
  const quota = classifyAnalysisError(apiError(429, "You exceeded your current quota", { code: "insufficient_quota" }));
  assert.equal(quota.kind, "quota_exhausted");
  assert.equal(quota.retryable, false);
});

test("F: HTTP 5xx is retryable", () => {
  for (const status of [500, 502, 503, 504]) {
    const error = classifyAnalysisError(apiError(status, "server error"));
    assert.equal(error.kind, "provider_unavailable");
    assert.equal(error.retryable, true);
  }
});

test("G: network failures and timeouts are retryable", async () => {
  assert.equal(classifyAnalysisError(Object.assign(new Error("Connection error."), { name: "APIConnectionError" })).kind, "network");
  assert.equal(classifyAnalysisError(new TypeError("fetch failed")).kind, "network");
  assert.equal(classifyAnalysisError(Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" })).kind, "timeout");
  // Our own deadline aborts a hung request.
  const hung = { responses: { create: (_params, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" })))) } };
  await assert.rejects(analyzeInterviewTranscript(hung, input, { timeoutMs: 20 }), (error) => error.kind === "timeout" && error.retryable === true);
});

test("retry backoff grows exponentially and is capped", () => {
  assert.deepEqual([1, 2, 3, 4].map(analysisRetryDelayMs), [15_000, 60_000, 240_000, 960_000]);
  assert.equal(analysisRetryDelayMs(9), 30 * 60 * 1000);
});

test("the pipeline fails fast on permanent errors and backs off on transient ones", () => {
  const store = read("src/lib/live-interview-store.ts");
  const process = store.slice(store.indexOf("export async function processLiveInterviewSession"), store.indexOf("export async function runLiveInterviewProcessing"));
  assert.match(process, /const final = terminal \|\| !classified\.retryable;/);
  assert.match(process, /const retryAfterMs = final \? 0 : analysisRetryDelayMs\(attempt\);/);
  assert.match(store, /processingLeaseUntil: retryAfterMs > 0 && !terminal \? new Date\(at\.getTime\(\) \+ retryAfterMs\) : null/, "backoff holds the lease until the next attempt");
  assert.match(store, /new OpenAI\(\{ apiKey: interviewAnalysisApiKey\(\), maxRetries: 2 \}\)/, "SDK retries (transient only) stay bounded");
});

// H / L -----------------------------------------------------------------------
test("H + L: HR retry reruns only the failed work, idempotently, and refuses while a worker is active", () => {
  const store = read("src/lib/live-interview-store.ts");
  const retry = store.slice(store.indexOf("export async function requestLiveInterviewRetry"), store.indexOf("export async function recoverStaleLiveInterviews"));
  assert.match(retry, /if \(session\.analysis \|\| /, "a completed analysis is never redone");
  assert.match(retry, /isNull\(liveInterviewSessions\.analysis\)/);
  assert.match(retry, /isNull\(liveInterviewSessions\.processingLeaseUntil\), lt\(liveInterviewSessions\.processingLeaseUntil, now\), sql`\$\{liveInterviewSessions\.failureStage\} <> ''`/, "an active worker's lease is respected");
  assert.match(retry, /refetchTranscript \? \{ transcriptSource: "" \} : \{\}/, "the stored transcript is kept unless none was ever retrieved");
  assert.doesNotMatch(retry, /delete\(|recording|consent|interviewCompletedAt|interviewStartedAt|hrNotes|credit/i, "retry never touches recording, consent, timestamps, notes, or credits");
  const process = store.slice(store.indexOf("export async function processLiveInterviewSession"), store.indexOf("export async function runLiveInterviewProcessing"));
  assert.match(process, /or\(isNull\(liveInterviewSessions\.processingLeaseUntil\), lt\(liveInterviewSessions\.processingLeaseUntil, now\)\)/, "one worker at a time");
  assert.match(process, /\.where\(and\(eq\(liveInterviewSessions\.id, session\.id\), isNull\(liveInterviewSessions\.analysis\)\)\)/, "the analysis is written at most once");
  assert.match(process, /removeReviewFlag\(session\.reviewFlags, "analysis_failed"\)/, "a successful retry clears the failure flag");

  const route = read("src/app/api/applicants/[applicationId]/live-interview/retry/route.ts");
  assert.match(route, /requestLiveInterviewRetry\(review\.sessionId\)/);
  assert.match(route, /if \(started\) \{\s*after\(/, "processing starts only when this request won the retry");
  const component = read("src/components/LiveInterviewReview.tsx");
  assert.match(component, /if \(retrying\) return;/, "double clicks are ignored client-side");
  assert.match(component, /disabled=\{retrying\}/);
  assert.match(component, /Retrying analysis…/);
  assert.match(component, />\{retrying \? "Retrying analysis…" : "Retry analysis"\}</);
});

test("L: removing and re-adding review flags is idempotent", () => {
  const flags = [{ code: "analysis_failed", message: "x" }, { code: "not_scored", message: "y" }];
  assert.deepEqual(removeReviewFlag(flags, "analysis_failed").map((flag) => flag.code), ["not_scored"]);
  assert.deepEqual(removeReviewFlag(removeReviewFlag(flags, "analysis_failed"), "analysis_failed").map((flag) => flag.code), ["not_scored"]);
});

// I / J / M --------------------------------------------------------------------
test("I: a completed interview whose analysis failed is still Completed", () => {
  assert.equal(deriveInterviewState("FAILED"), "completed");
  assert.equal(deriveAnalysisState("FAILED", false), "failed");
  assert.equal(INTERVIEW_STATE_LABELS[deriveInterviewState("FAILED")], "Completed");
  assert.match(ANALYSIS_STATE_LABELS.failed, /retry available/i);
  assert.equal(deriveInterviewState("ANALYSIS_PROCESSING"), "completed");
  assert.equal(deriveAnalysisState("ANALYSIS_PROCESSING", false), "processing");
  assert.equal(deriveAnalysisState("INTERVIEW_COMPLETED", false), "pending");
  assert.equal(deriveInterviewState("INTERVIEW_IN_PROGRESS"), "in_progress");
  for (const status of ["NOT_STARTED", "CONSENTED", "DEVICE_CHECK"]) assert.equal(deriveInterviewState(status), "not_started");
  for (const status of LIVE_INTERVIEW_STATUSES) assert.ok(INTERVIEW_STATE_LABELS[deriveInterviewState(status)]);
  const component = read("src/components/LiveInterviewReview.tsx");
  assert.match(component, /<span>Interview Status<\/span><strong>\{INTERVIEW_STATE_LABELS\[review\.interviewState\]\}/);
  assert.match(component, /<span>AI Analysis Status<\/span>/);
});

test("J: an analysis failure never deletes or overwrites the transcript, recording, or consent", () => {
  const store = read("src/lib/live-interview-store.ts");
  const failure = store.slice(store.indexOf("async function recordFailure"), store.indexOf("/** Moves the application to HR review"));
  assert.doesNotMatch(failure, /transcript|recording|consent|interviewCompletedAt|delete\(/i);
  const process = store.slice(store.indexOf("// Stage 3: AI analysis"), store.indexOf("export async function runLiveInterviewProcessing"));
  assert.doesNotMatch(process, /replaceTranscript|liveInterviewTranscriptTurns|recordingStatus|recordingStorageRef|consent/);
});

test("M: existing completed interviews keep working", () => {
  assert.equal(deriveAnalysisState("REVIEW_READY", true), "completed");
  assert.equal(deriveInterviewState("REVIEW_READY"), "completed");
  // A stored analysis from before this change still validates.
  const legacy = { interviewSummary: "Discussed support work.", relevantExperience: [], skillsMentioned: [], strengthsEvidenced: [], areasToClarify: [], notableResponses: [], questionReviews: [{ questionIndex: pairs[0].questionIndex, analysis: "ok", jobCriteria: "", evidence: "" }] };
  assert.equal(sanitizeInterviewAnalysis(legacy, { pairs, maxSeq: 6 }).questionReviews[0].rating, null);
  const migration = read("drizzle/0026_live_interview_sessions.sql");
  assert.match(migration, /"status"/, "no new status values or columns are needed: states are derived");
});

// K ---------------------------------------------------------------------------
test("K: legacy review flags that embedded the raw provider error are shown with fixed wording", () => {
  const raw = "Automatic analysis failed: 400 Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'.";
  const flags = safeReviewFlags([{ code: "analysis_failed", message: raw }, { code: "recording_failed", message: "The interview recording is not available: TypeError: Failed to fetch" }, { code: "interview_interrupted", message: "The interview ended unexpectedly." }]);
  const text = flags.map((flag) => flag.message).join(" ");
  assert.doesNotMatch(text, /400|json|text\.format|TypeError|fetch/i);
  assert.match(flags[0].message, /can be retried/);
  assert.equal(flags[2].message, "The interview ended unexpectedly.", "product wording is kept");
});

test("K: HR-facing failure messages contain no technical detail", () => {
  const first = processingFailureMessage("analysis", false);
  const repeat = processingFailureMessage("analysis", true);
  assert.equal(first, "Interview analysis could not be completed. The recording and transcript have been safely preserved. Please retry the analysis.");
  assert.equal(repeat, "Interview analysis is temporarily unavailable. The interview recording and transcript remain available for review. Please try again later or contact your system administrator.");
  for (const message of [first, repeat, processingFailureMessage("transcription", false), processingFailureMessage("transcription", true)]) {
    assert.equal(looksTechnical(message), false, message);
    assert.doesNotMatch(message, /\b\d{3}\b|openai|heygen|liveavatar|json|http/i);
  }
});

test("K: the review DTO and component never carry or render raw errors", () => {
  const store = read("src/lib/live-interview-store.ts");
  const dto = store.slice(store.indexOf("export type LiveInterviewReview"), store.indexOf("/** Recording reference for authenticated HR playback"));
  assert.doesNotMatch(dto, /lastError:|recordingError|error: session\./, "raw last_error / recording_error stay server-side");
  assert.match(dto, /reviewFlags: safeReviewFlags\(session\.reviewFlags\)/);
  assert.match(dto, /errorReference:/);
  const component = read("src/components/LiveInterviewReview.tsx");
  assert.doesNotMatch(component, /lastError|recording\.error|error\.message|body\.error/);
  assert.match(component, /processingFailureMessage\(/);
  assert.match(component, /Reference: \$\{review\.errorReference\}/);
});

test("K: failures are logged server-side with a reference that the HR page repeats", () => {
  assert.match(errorReference("seed"), /^ERR-[0-9A-F]{8}$/);
  assert.equal(errorReference("same"), errorReference("same"), "deterministic for a stored failure");
  assert.notEqual(errorReference(), errorReference());
  const store = read("src/lib/live-interview-store.ts");
  assert.match(store, /logInternalError\(stage === "analysis" \? "InterviewAnalysisError" : "LiveInterviewProcessingError"/);
  assert.match(store, /providerStatus: classified\.providerStatus, providerRequestId: classified\.providerRequestId/);
  const failure = store.slice(store.indexOf("async function recordFailure"), store.indexOf("/** Moves the application to HR review"));
  assert.doesNotMatch(failure, /turns|transcript|candidateName|email|phone/i, "no candidate content in the log context");
});

test("K: central helpers keep business wording but hide provider, network, and parser errors", async () => {
  const leak = new Error("400 Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'.");
  await quiet(() => {
    assert.equal(publicErrorMessage(leak, "Fallback."), "Fallback.");
    assert.equal(safeErrorResponse(leak, "Fallback.").message, "Fallback.");
    assert.match(safeErrorResponse(leak, "Fallback.").reference, /^ERR-/);
    assert.equal(publicErrorMessage(new Error("connect ECONNREFUSED 10.0.0.1:5432"), "Fallback."), "Fallback.");
    assert.equal(publicErrorMessage(new Error("Request failed with status code 502"), "Fallback."), "Fallback.");
  });
  assert.equal(publicErrorMessage(new Error("That time is no longer available. Please select another time."), "Fallback."), "That time is no longer available. Please select another time.");
  assert.equal(clientErrorMessage(new TypeError("Failed to fetch"), "Fallback."), "Fallback.");
  assert.equal(clientErrorMessage(new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"), "Fallback."), "Fallback.");
  assert.equal(clientErrorMessage(new Error("Please choose a role first."), "Fallback."), "Please choose a role first.");
  assert.equal(clientErrorMessage("nope", "Fallback."), "Fallback.");
});

test("K: audited client-facing routes and components no longer echo raw error messages", () => {
  const routes = [
    "src/app/api/applicants/[applicationId]/route.ts",
    "src/app/api/ella-credits/route.ts",
    "src/app/api/live-avatar/evaluate/route.ts",
    "src/app/api/live-avatar/prepare/route.ts",
    "src/app/api/resume-screening/bulk/extract/route.ts",
    "src/app/api/resume-screening/bulk/retry/route.ts",
    "src/app/api/resume-screening/bulk/upload/route.ts",
    "src/app/api/resume-screening/drive/import/route.ts",
    "src/app/api/roles/[roleId]/route.ts",
    "src/app/api/uploads/resumes/route.ts",
  ];
  for (const path of routes) assert.doesNotMatch(read(path), /error instanceof Error\s*\?\s*error\.message/, path);
  for (const path of ["src/components/BookingsList.tsx", "src/components/BulkResumeScreeningPanel.tsx", "src/components/RoleRequestForm.tsx", "src/components/InterviewPrecheck.tsx", "src/components/LiveAvatarInterview.tsx", "src/components/CandidateApplicationForm.tsx", "src/components/DriveFilePicker.tsx"]) {
    assert.doesNotMatch(read(path), /(caught|error|err) instanceof Error \? \1\.message/, path);
  }
});

test("applicants are never told their interview failed because analysis failed", () => {
  const notice = read("src/components/InterviewStatusNotice.tsx");
  assert.doesNotMatch(notice, /analysis failed|processing failed/i);
  assert.match(notice, /Your interview has been completed\./);
  const store = read("src/lib/live-interview-store.ts");
  const candidate = store.slice(store.indexOf("export async function getCandidateInterviewStatus"));
  assert.doesNotMatch(candidate, /lastError|failureStage|analysis/);
  const page = read("src/app/avatar/[token]/page.tsx");
  assert.match(page, /inProgress=\{interview\.status === "INTERVIEW_IN_PROGRESS"\}/, "FAILED sessions show the completed notice");
});
