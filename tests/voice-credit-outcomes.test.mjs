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

test("booking no longer owns the Postgres Pilot voice charge", () => {
  const workflow = readFileSync(new URL("../src/lib/applicant-workflow.ts", import.meta.url), "utf8");
  const targetBooking = workflow.slice(workflow.indexOf("async function reserveTargetBooking"), workflow.indexOf("async function reserveBookingInternal"));
  assert.doesNotMatch(targetBooking, /recordDeduction/);
  assert.doesNotMatch(targetBooking, /assertCreditsAvailable/);
});

test("voice result and log routes expose outcome billing fields", () => {
  for (const path of ["src/app/api/internal/recruitment/voice/results/route.ts", "src/app/api/internal/recruitment/voice/logs/route.ts"]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /chargedCredits/);
    assert.match(source, /billingOutcome/);
  }
});
