import assert from "node:assert/strict";
import test from "node:test";

import { retrieveContext, knowledgeHeadings } from "../src/lib/help-bot/knowledge.ts";
import { buildUserPrompt, directHelpAnswer, HELP_BOT_STARTER_QUESTIONS } from "../src/lib/help-bot/prompt.ts";
import { MAX_FILES_PER_SUBMISSION } from "../src/lib/bulk-resume-limits.ts";

// Regression coverage for the exact failure this once had: the bulk-upload
// limit was hardcoded independently in knowledge.md ("8", later "4") and in
// prompt.ts's directHelpAnswer ("4"), both silently drifting from the real
// enforced value in bulk-resume-limits.ts. These tests execute the real
// retrieval/answer code (not a static grep) against the real constant, so if
// either source is ever hardcoded again instead of substituted/imported, the
// resulting text won't contain the live number and this fails.
test("the direct bulk-limit answer states the live MAX_FILES_PER_SUBMISSION, not a hardcoded number", () => {
  const answer = directHelpAnswer("What is the bulk screening limit?") || "";
  assert.match(answer, new RegExp(`\\b${MAX_FILES_PER_SUBMISSION}\\b`));
  assert.match(answer, /files per batch/);
});

test("the knowledge base's bulk-limit sections state the live MAX_FILES_PER_SUBMISSION, not a hardcoded number", () => {
  const context = retrieveContext("what is the bulk screening limit");
  assert.equal(context.hasMatch, true);
  assert.match(context.text, new RegExp(`\\b${MAX_FILES_PER_SUBMISSION}\\b`));
  // The placeholder must always be substituted -- never leak into an answer.
  assert.doesNotMatch(context.text, /\{\{BULK_FILE_LIMIT\}\}/);
  // Regression guard: this doc has drifted to stale hardcoded numbers before
  // (8, then 4) while the enforced limit moved independently. Fail loudly if
  // either stale number reappears next to "file"/"files" wording, since that
  // is exactly the shape the old bugs took.
  for (const stale of [4, 8]) {
    if (stale === MAX_FILES_PER_SUBMISSION) continue;
    assert.doesNotMatch(context.text, new RegExp(`\\b${stale}\\b[^.]*files`, "i"));
  }
});

test("knowledge base parses into sections", () => {
  const headings = knowledgeHeadings();
  assert.ok(headings.length > 10, "expected many FAQ sections");
  assert.ok(headings.includes("How to create a role requisition (role request)"));
  assert.ok(headings.includes("How credits work (Smile Credits)"));
});

test("retrieval surfaces the relevant section for a question", () => {
  const context = retrieveContext("How do I upload lots of resumes at once?");
  assert.equal(context.hasMatch, true);
  const headings = context.sections.map((section) => section.heading);
  assert.ok(headings.includes("How bulk resume upload works"));
  // Framing sections are always included.
  assert.ok(headings.includes("Overview: what the portal is for"));
});

test("retrieval explains all three HR resume screening options", () => {
  const context = retrieveContext("what are the three ways to screen resumes");
  assert.equal(context.hasMatch, true);
  const headings = context.sections.map((section) => section.heading);
  assert.ok(headings.includes("The three HR ways to screen resumes"));
  assert.match(context.text, /computer/);
  assert.match(context.text, /Google Drive/);
  assert.match(context.text, /OneDrive/);
});

test("retrieval understands common CV and score wording", () => {
  const context = retrieveContext("why is my CV grading score blank");
  assert.equal(context.hasMatch, true);
  assert.ok(context.sections.some((section) => section.heading === "How resume screening works"));
});

test("Ella answers common orientation questions clearly", () => {
  assert.match(directHelpAnswer("who are you?") || "", /I'm Smile/);
  assert.match(directHelpAnswer("what can you do?") || "", /guide you through using the portal/);
  assert.equal(directHelpAnswer("what is my applicant score?"), null);
});

test("Ella directly lists the three HR resume screening options", () => {
  const answer = directHelpAnswer("How many ways are there to screen resumes?") || "";
  assert.match(answer, /computer/);
  assert.match(answer, /Google Drive/);
  assert.match(answer, /OneDrive/);
  assert.match(answer, /same queue/);
});

test("Ella answers safe signed-in account questions from session context", () => {
  const answer = directHelpAnswer("What is my portal role and department?", {
    accessRole: "HR",
    department: "AI",
    canReviewRole: true,
    canManageUsers: true,
  }) || "";
  assert.match(answer, /HR/);
  assert.match(answer, /AI/);
  assert.match(answer, /manage user accounts/);
});

test("retrieval matches voice interview scheduling", () => {
  const context = retrieveContext("how does the AI voice interview booking work");
  assert.ok(context.sections.some((s) => s.heading === "How voice interview scheduling works"));
});

test("off-topic questions produce no keyword match and a fallback instruction", () => {
  const context = retrieveContext("what is the weather in Tokyo tomorrow");
  assert.equal(context.hasMatch, false);
  const prompt = buildUserPrompt(context, "what is the weather in Tokyo tomorrow");
  assert.match(prompt, /don't have that information|contacting HR/i);
});

test("user prompt embeds the knowledge and the question", () => {
  const context = retrieveContext("what do the applicant stages mean");
  const prompt = buildUserPrompt(context, "what do the applicant stages mean");
  assert.match(prompt, /KNOWLEDGE/);
  assert.match(prompt, /USER QUESTION: what do the applicant stages mean/);
  assert.match(prompt, /Resume HR Review/);
});

test("user prompt includes only safe account context for account questions", () => {
  const context = retrieveContext("what is my access role");
  const prompt = buildUserPrompt(context, "what is my access role", { accessRole: "HR", department: "AI", canReviewRole: true });
  assert.match(prompt, /SIGNED-IN ACCOUNT CONTEXT/);
  assert.match(prompt, /Access role: HR/);
  assert.match(prompt, /Department: AI/);
  assert.match(prompt, /Do not infer live records/);
});

test("starter questions are defined", () => {
  assert.ok(HELP_BOT_STARTER_QUESTIONS.length >= 4);
});
