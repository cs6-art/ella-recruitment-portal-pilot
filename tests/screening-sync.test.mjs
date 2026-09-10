import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMatchScore, parseScreeningResult } from "../src/lib/recruitment-screening.ts";

test("screening scores accept numeric n8n strings and snake_case payload values", () => {
  assert.equal(normalizeMatchScore(75), 75);
  assert.equal(normalizeMatchScore("75"), 75);
  assert.equal(normalizeMatchScore("75%"), 75);
  assert.equal(normalizeMatchScore(" 75.9 "), 75);
});

test("empty screening scores remain distinguishable from malformed scores", () => {
  assert.equal(normalizeMatchScore(undefined), undefined);
  assert.equal(normalizeMatchScore(null), null);
  assert.equal(normalizeMatchScore(""), null);
  assert.equal(normalizeMatchScore("not-a-score"), undefined);
  assert.equal(normalizeMatchScore(101), undefined);
});

test("bulk screening accepts the compatible camelCase score alias without relaxing the result shape", () => {
  const result = parseScreeningResult({
    matchScore: "84",
    recommendation: "For HR Review",
    ai_summary: "Relevant experience found.",
    strengths: ["Relevant experience"],
    gaps: ["Needs HR confirmation"],
    interview_questions: ["What is your experience?", "How do you prioritize?", "What would you improve?"],
  });
  assert.equal(result.match_score, 84);
});
