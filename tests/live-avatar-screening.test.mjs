import assert from "node:assert/strict";
import test from "node:test";

import { evaluateLiveAvatarTranscript, prepareLiveAvatarScreening } from "../src/lib/live-avatar-screening.ts";

test("resume preparation produces a concise role-specific question and summary", () => {
  const preparation = prepareLiveAvatarScreening({
    roleTitle: "Security & QA Test Engineer",
    roleDescription: "Own automated testing, API quality, and secure release workflows.",
    resumeText: "Alex Chen\nBuilt API test automation with Playwright and introduced secure release checks.\nReduced escaped defects by 30%.",
  });
  assert.match(preparation.resumeSummary, /Security & QA Test Engineer/);
  assert.match(preparation.resumeSummary, /Playwright|API|secure/i);
  assert.match(preparation.screeningQuestion, /experience|testing|API|secure/i);
});

test("approved questions are preserved for the avatar", () => {
  const preparation = prepareLiveAvatarScreening({
    roleTitle: "QA Engineer",
    roleDescription: "Automated testing",
    approvedQuestions: ["Tell us about a release you made safer."],
    resumeText: "Candidate has experience with testing and release quality.",
  });
  assert.equal(preparation.screeningQuestion, "Tell us about a release you made safer.");
});

test("transcript evaluation identifies an answer, strengths, and follow-up areas", () => {
  const result = evaluateLiveAvatarTranscript({
    roleTitle: "Security & QA Test Engineer",
    roleDescription: "Own automated testing, API quality, and secure release workflows.",
    question: "How did you improve API test automation and what was the outcome?",
    transcript: [
      { role: "avatar", transcript: "How did you improve API test automation and what was the outcome?" },
      { role: "user", transcript: "I built Playwright API tests and added secure release checks, reducing escaped defects by 30 percent." },
    ],
  });
  assert.equal(result.answered, true);
  assert.ok(result.score > 0);
  assert.match(result.summary, /response/i);
  assert.ok(result.strengths.length > 0);
});

test("transcript evaluation does not invent a response", () => {
  const result = evaluateLiveAvatarTranscript({
    roleTitle: "QA Engineer",
    roleDescription: "Automated testing",
    question: "Tell us about your testing experience.",
    transcript: [{ role: "avatar", transcript: "Tell us about your testing experience." }],
  });
  assert.equal(result.answered, false);
  assert.equal(result.score, 0);
});
