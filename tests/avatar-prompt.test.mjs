import assert from "node:assert/strict";
import test from "node:test";
import { STANDARD_AVATAR_SYSTEM_PROMPT_TEMPLATE, avatarPromptVariables, renderAvatarPrompt } from "../src/lib/avatar-prompt.ts";

const role = { roleTitle: "Sales Rep", jobDescription: "Sell things.", roleRequirements: "KEYWORDS: crm", interviewQuestions: "Q1: One?\nQ2: Two?\nQ3: Three?", evaluationFields: "- Score (result key: score)" };

test("standard script has no stale single-question wording and is branded Smile", () => {
  assert.doesNotMatch(STANDARD_AVATAR_SYSTEM_PROMPT_TEMPLATE, /optional question|\bElla\b/i);
  assert.match(STANDARD_AVATAR_SYSTEM_PROMPT_TEMPLATE, /You are Smile/);
});

test("role tokens are filled and per-candidate tokens become LiveAvatar variables", () => {
  const out = renderAvatarPrompt("", role);
  assert.match(out, /Q3: Three\?/);
  assert.match(out, /Sales Rep/);
  assert.doesNotMatch(out, /\{\{/);
  assert.deepEqual(avatarPromptVariables(out).sort(), ["candidate_name", "resume_summary"]);
});

test("custom scripts are rebranded and unknown tokens are left alone", () => {
  const out = renderAvatarPrompt("I am Ella for {{role_title}} {{mystery}}", role);
  assert.equal(out, "I am Smile for Sales Rep {{mystery}}");
});
