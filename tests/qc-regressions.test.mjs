import assert from "node:assert/strict";
import test from "node:test";

import { evaluateVoiceInterview } from "../src/lib/voice-interview-evaluation.ts";
import { extractResumeContactDetails } from "../src/lib/resume-contact-extraction.ts";

test("completed voice repair records strengths and concerns from interview evidence", () => {
  const result = evaluateVoiceInterview({
    roleTitle: "QA Automation Engineer",
    roleDescription: "Build automated regression tests, API testing, and CI/CD integration.",
    resumeSummary: "QA Automation Engineer with 5 years' experience using Playwright and Selenium.",
    baseScore: 81,
    transcript: [
      "AI: How many years of hands-on test automation experience do you have?",
      "User: I have 30 years of test automation experience and more than 70 projects.",
      "AI: Which frameworks have you used?",
      "User: I have used Playwright and many AI tools.",
      "AI: How do you handle flaky tests in CI/CD?",
      "User: I report the problem to another person and wait for escalation.",
    ].join("\n"),
  });
  assert.ok(result.strengths.includes("70 projects"));
  assert.match(result.concerns, /30 years|5 years|timeline/i);
  assert.match(result.recommendation, /Manual Review/i);
  assert.ok(result.score < 81);
});

test("resume contact extraction preserves line-based candidate names", () => {
  const result = extractResumeContactDetails([
    "Ahmad Firdaus",
    "ahmad@example.com",
    "+60 12 345 6789",
    "QA Automation Engineer",
  ].join("\n"));
  assert.equal(result.candidateName, "Ahmad Firdaus");
  assert.equal(result.candidateEmail, "ahmad@example.com");
});
