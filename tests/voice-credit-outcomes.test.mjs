import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  classifyVoiceInterviewBillingOutcome,
  CREDIT_COST,
  VOICE_INTERVIEW_BILLING_COST,
} from "../src/lib/ella-credit-math.ts";

test("voice billing waits for a terminal outcome", () => {
  assert.equal(classifyVoiceInterviewBillingOutcome({ callStatus: "initiated" }), null);
  assert.equal(classifyVoiceInterviewBillingOutcome({ callStatus: "in_progress", transcript: "" }), null);
});

test("voice billing maps the requested outcomes to the requested costs", () => {
  assert.equal(classifyVoiceInterviewBillingOutcome({ callStatus: "completed", transcript: "Q1: answer" }), "completed");
  assert.equal(classifyVoiceInterviewBillingOutcome({ callStatus: "no_show" }), "no_answer");
  assert.equal(classifyVoiceInterviewBillingOutcome({ callFinalStatus: "busy" }), "no_answer");
  assert.equal(classifyVoiceInterviewBillingOutcome({ callStatus: "completed", isComplete: false, transcript: "partial" }), "incomplete");
  assert.equal(classifyVoiceInterviewBillingOutcome({ callStatus: "completed", completenessScore: 80, transcript: "partial" }), "incomplete");
  assert.equal(classifyVoiceInterviewBillingOutcome({ callStatus: "ended", callFinalStatus: "customer-ended-call", transcript: "User: Hello", raw: { body: { message: { analysis: { structuredData: { interview_completed: false, answered_question_count: 0 } } } } } }), "incomplete");
  assert.deepEqual(VOICE_INTERVIEW_BILLING_COST, { completed: 10, no_answer: 5, incomplete: 8 });
  assert.equal(CREDIT_COST.phone_interview, 10);
});

test("Vapi no-contact ended reasons all bill as no_answer (-5), never incomplete", () => {
  // The regression: `customer-busy` used to fall through to `incomplete` (-8)
  // because "ended" is a terminal signal and no NO_ANSWER entry matched.
  for (const reason of [
    "customer-busy",
    "customer_busy",
    "busy",
    "customer-did-not-answer",
    "customer_did_not_answer",
    "no-answer",
    "no_answer",
    "voicemail",
    "no-show",
    "no_show",
  ]) {
    assert.equal(
      classifyVoiceInterviewBillingOutcome({ outcome: reason, callFinalStatus: "ended", transcript: "" }),
      "no_answer",
      `${reason} should bill as no_answer`,
    );
    assert.equal(VOICE_INTERVIEW_BILLING_COST.no_answer, 5);
  }
});

test("the exact mis-billed live callback now classifies as no_answer", () => {
  assert.equal(
    classifyVoiceInterviewBillingOutcome({ callFinalStatus: "ended", outcome: "customer-busy", transcript: "" }),
    "no_answer",
  );
});

test("a connected-but-unfinished interview still bills as incomplete (-8)", () => {
  assert.equal(classifyVoiceInterviewBillingOutcome({ callStatus: "ended", outcome: "incomplete", transcript: "" }), "incomplete");
  assert.equal(VOICE_INTERVIEW_BILLING_COST.incomplete, 8);
});

test("non-terminal outcomes, cancellations, and provider failures are free", () => {
  for (const input of [
    { callStatus: "initiated" },
    { callStatus: "in_progress", transcript: "" },
    { outcome: "cancelled" },
    { outcome: "provider_failure" },
    { outcome: "system_failure" },
  ]) assert.equal(classifyVoiceInterviewBillingOutcome(input), null);
});

test("booking no longer owns the Postgres Pilot voice charge", () => {
  const workflow = readFileSync(new URL("../src/lib/applicant-workflow.ts", import.meta.url), "utf8");
  const booking = workflow.slice(workflow.indexOf("async function reserveTargetBooking"), workflow.indexOf("if (kind === \"final\")", workflow.indexOf("async function reserveBookingInternal")));
  assert.doesNotMatch(booking, /recordDeduction/);
  assert.doesNotMatch(booking, /recordVoiceInterviewDeduction/);
});

test("terminal billing is owned by voice result ingestion and remains idempotent per attempt", () => {
  const queries = readFileSync(new URL("../src/lib/internal-recruitment-queries.ts", import.meta.url), "utf8");
  const credits = readFileSync(new URL("../src/lib/ella-credits.ts", import.meta.url), "utf8");
  const booking = queries.slice(queries.indexOf("export async function bookInterviewSlot"), queries.indexOf("export async function calendarEventQueue"));
  assert.doesNotMatch(booking, /recordVoiceInterviewDeduction/);
  assert.match(credits, /idempotencyKey: `voice-attempt:\$\{input\.attemptId\}`/);
  assert.match(queries, /export async function ingestVoiceResult/);
  assert.match(queries, /export async function createVoiceCallLog/);
});

test("dispatch retains the maximum voice charge preflight", () => {
  const dispatch = readFileSync(new URL("../src/app/api/internal/recruitment/voice/dispatch/route.ts", import.meta.url), "utf8");
  assert.match(dispatch, /assertCreditsAvailable\(1, "phone_interview", \{ organizationId: context\.organizationId/);
});

test("voice result and log routes expose outcome billing fields", () => {
  for (const path of ["src/app/api/internal/recruitment/voice/results/route.ts", "src/app/api/internal/recruitment/voice/logs/route.ts"]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /chargedCredits/);
    assert.match(source, /billingOutcome/);
  }
});

test("voice review repairs Vapi artifact structured outputs without duplicating results", () => {
  const queries = readFileSync(new URL("../src/lib/internal-recruitment-queries.ts", import.meta.url), "utf8");
  assert.match(queries, /artifact\.structuredOutputs/);
  assert.match(queries, /structured\.match_score/);
  assert.match(queries, /repair:voice-result:\$\{result\.id\}/);
  assert.match(queries, /if \(result\.score == null && normalized\.score != null\)/);
  assert.match(queries, /onConflictDoNothing\(\{ target: voiceCallLogs\.sourceEventKey \}\)/);
});

// Regression for a 2026-09-15 pilot incident: n8n's POST to
// /voice/attempts/status legitimately sends outcome: "incomplete" (a
// VoiceInterviewBillingOutcome value, produced by
// classifyVoiceInterviewBillingOutcome) straight through to
// updateVoiceAttemptStatus(), which wrote it unmapped into
// voice_call_attempts.outcome — a column with its own, narrower CHECK
// constraint that has never allowed "incomplete" (only 'completed',
// 'no_answer', 'busy', 'wrong_person', 'no_show', 'cancelled',
// 'system_failure' — see drizzle/0006_voice_attempt_dispatch_states.sql).
// Every real call had silently gone through the *other* path
// (settleVoiceAttemptFromResult, which already maps "incomplete" to the
// attempt-level "completed") until this exact endpoint ran for the first
// time and threw an unhandled constraint violation. Reproduced directly
// against the real database with tsx before this fix; confirmed fixed after.
test("voice attempt outcome is normalized before it reaches the DB CHECK constraint", () => {
  const queries = readFileSync(new URL("../src/lib/internal-recruitment-queries.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../drizzle/0006_voice_attempt_dispatch_states.sql", import.meta.url), "utf8");

  assert.match(queries, /function normalizeVoiceAttemptOutcome/);
  assert.match(queries, /if \(value === "incomplete"\) return "completed";/);
  // The UPDATE must run every outcome through the normalizer, never the raw
  // caller-supplied value.
  assert.match(queries, /outcome = \$\{normalizeVoiceAttemptOutcome\(input\.outcome\)\}/);
  assert.doesNotMatch(queries, /outcome = \$\{input\.outcome \|\| null\}/);

  // Cross-check: every value the code treats as already-valid must actually
  // be present in the live DB constraint, so a future migration edit that
  // narrows the allowed set (without updating the code) fails this test
  // instead of failing silently in production again.
  const constraintBlock = migration.slice(migration.indexOf("voice_call_attempts_outcome_check"));
  const allowedInDb = [...constraintBlock.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  const codeSetMatch = queries.match(/VOICE_ATTEMPT_OUTCOME_VALUES = new Set\(\[([^\]]+)\]\)/);
  assert.ok(codeSetMatch, "expected VOICE_ATTEMPT_OUTCOME_VALUES to be defined");
  const allowedInCode = [...codeSetMatch[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  assert.deepEqual(new Set(allowedInCode), new Set(allowedInDb));
});
