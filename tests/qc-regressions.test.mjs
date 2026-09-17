import assert from "node:assert/strict";
import test from "node:test";

import { evaluateVoiceInterview } from "../src/lib/voice-interview-evaluation.ts";
import { extractResumeContactDetails } from "../src/lib/resume-contact-extraction.ts";
import { applyScreeningEvidenceGuard, parseScreeningResult } from "../src/lib/recruitment-screening.ts";

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

test("resume screening guard differentiates a non-QA resume from a QA role", () => {
  const result = applyScreeningEvidenceGuard({
    result: parseScreeningResult({
      match_score: 68,
      recommendation: "For HR Review",
      ai_summary: "The candidate has strong visual design experience.",
      strengths: ["Strong visual design experience."],
      gaps: [],
      interview_questions: ["Question one", "Question two", "Question three"],
    }),
    roleTitle: "QA Automation Engineer",
    roleDescription: "Build automated regression tests and maintain CI/CD quality gates.",
    requiredSkills: "Playwright, API testing, test automation",
    screeningCriteria: "Hands-on QA automation experience required.",
    resumeText: "Product designer with ten years of branding and visual design experience.",
  });
  assert.equal(result.match_score, 49);
  assert.match(result.gaps[0], /QA|test automation/i);
  assert.match(result.ai_summary, /Direct-evidence check/i);
});
