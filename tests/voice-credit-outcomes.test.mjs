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
  assert.deepEqual(VOICE_INTERVIEW_BILLING_COST, { completed: 10, no_answer: 5, incomplete: 8 });
  assert.equal(CREDIT_COST.phone_interview, 10);
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
  assert.match(dispatch, /assertCreditsAvailable\(1, "phone_interview"\)/);
});

test("voice result and log routes expose outcome billing fields", () => {
  for (const path of ["src/app/api/internal/recruitment/voice/results/route.ts", "src/app/api/internal/recruitment/voice/logs/route.ts"]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /chargedCredits/);
    assert.match(source, /billingOutcome/);
  }
});
