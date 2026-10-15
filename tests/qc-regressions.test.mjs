import assert from "node:assert/strict";
import test from "node:test";

import { evaluateVoiceInterview } from "../src/lib/voice-interview-evaluation.ts";
import { extractResumeContactDetails, verifiedResumeName } from "../src/lib/resume-contact-extraction.ts";
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

test("resume name extraction skips section headings and job-title lines", () => {
  const heading = extractResumeContactDetails([
    "PROFESSIONAL EXPERIENCE",
    "Data Center Technician",
    "ALLEN PESIGAN",
    "allen.pesigan@example.com",
  ].join("\n"));
  assert.equal(heading.candidateName, "Allen Pesigan");

  const company = extractResumeContactDetails([
    "DATA CENTER OPERATIONS ASIA",
    "Shanna Fate Macatangay",
    "shanna.m@example.com | 0917 123 4567",
  ].join("\n"));
  assert.equal(company.candidateName, "Shanna Fate Macatangay");
});

test("resume name extraction strips glued locations, rejoins spaced letters and uses email/filename hints", () => {
  assert.equal(extractResumeContactDetails("VALERIE LOPEZ Philippines\nvlopez@example.com").candidateName, "Valerie Lopez");
  assert.equal(extractResumeContactDetails("J U A N    D E L A    C R U Z\njdc@example.com").candidateName, "Juan Dela Cruz");
  // Both lines pass the filters; the one matching the email wins over position.
  assert.equal(extractResumeContactDetails("Bright Future Academy\nMaria Santos\nmaria.santos@example.com").candidateName, "Maria Santos");
  assert.equal(extractResumeContactDetails("Bright Future Academy\nMaria Santos\nms@example.com", { fileName: "Santos_Maria_CV.pdf" }).candidateName, "Maria Santos");
  // Nothing name-like in the text: fall back to the email address.
  assert.equal(extractResumeContactDetails("PROFESSIONAL SUMMARY\nallen.pesigan@example.com").candidateName, "Allen Pesigan");
});

test("AI candidate names are accepted only when grounded in the resume", () => {
  const resume = "VAL RIE LOPEZ Philippines\nvlopez@example.com\nPROFESSIONAL EXPERIENCE";
  assert.equal(verifiedResumeName("Valerie Lopez", resume, "vlopez@example.com"), "Valerie Lopez");
  assert.equal(verifiedResumeName("VALERIE LOPEZ", resume), "Valerie Lopez");
  assert.equal(verifiedResumeName("Jennifer Lopez", resume), "");
  assert.equal(verifiedResumeName("Lopez", resume), "");
  assert.equal(verifiedResumeName("", resume), "");
  assert.equal(verifiedResumeName(undefined, resume), "");
  assert.equal(verifiedResumeName("José Peña", "JOSE PENA\njp@example.com"), "José Peña");
});

test("screening results accept an optional candidate_name", () => {
  const base = { match_score: 70, recommendation: "For HR Review", ai_summary: "ok", strengths: [], gaps: [], interview_questions: ["a", "b", "c"] };
  assert.equal(parseScreeningResult(base).candidate_name, undefined);
  assert.equal(parseScreeningResult({ ...base, candidate_name: " Valerie Lopez " }).candidate_name, "Valerie Lopez");
});
