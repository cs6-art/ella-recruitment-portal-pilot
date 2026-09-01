import assert from "node:assert/strict";
import test from "node:test";

import { retrieveContext, knowledgeHeadings } from "../src/lib/help-bot/knowledge.ts";
import { buildUserPrompt, HELP_BOT_STARTER_QUESTIONS } from "../src/lib/help-bot/prompt.ts";

test("knowledge base parses into sections", () => {
  const headings = knowledgeHeadings();
  assert.ok(headings.length > 10, "expected many FAQ sections");
  assert.ok(headings.includes("How to create a role requisition (role request)"));
  assert.ok(headings.includes("How credits work (Ella Credits)"));
});

test("retrieval surfaces the relevant section for a question", () => {
  const context = retrieveContext("How do I upload lots of resumes at once?");
  assert.equal(context.hasMatch, true);
  const headings = context.sections.map((section) => section.heading);
  assert.ok(headings.includes("How bulk resume upload works"));
  // Framing sections are always included.
  assert.ok(headings.includes("Overview: what the portal is for"));
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

test("starter questions are defined", () => {
  assert.ok(HELP_BOT_STARTER_QUESTIONS.length >= 4);
});
