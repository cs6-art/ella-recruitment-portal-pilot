import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { knowledgeHeadings, retrieveContext } from "../src/lib/help-bot/knowledge.ts";
import { directHelpAnswer } from "../src/lib/help-bot/prompt.ts";
import { SELF_SERVICE_MEMBER_LIMIT } from "../src/lib/organization-signup.ts";

const SECTION = "How a company signs up and the people limit";
const guide = readFileSync("src/lib/help-bot/knowledge.md", "utf8");

// Each question is phrased the way people actually ask it, not with the guide's own headings.
const QUESTIONS = {
  "Can my company sign up by itself?": [/Nothing is\s+created until the email is confirmed/],
  "How do I start a new company in the portal?": [/creates the organisation for that domain/],
  "Why can't I register with my Gmail address?": [/Use\s+your work email address/],
  "Can I use my Yahoo email to sign up?": [/Personal email addresses/],
  "What is the people limit for a new company?": [/starts with a limit of 5 people/],
  "How many people can join my company?": [/limit of 5 people/],
  "Our company is full and my colleague cannot register": [/reached its limit on the number of people/],
  "How do I raise the member limit?": [/Only a McLink platform administrator/, /Member limit/],
  "Can the owner change the limit?": [/owner cannot change the limit/],
  "Does someone who never confirms their email use up a place?": [/24-hour link runs out/],
  "Do mclinkgroup.com staff start a new company?": [/never starts a new company/],
  "Can I invite a consultant with a personal email?": [/Gmail address/],
};

for (const [question, patterns] of Object.entries(QUESTIONS)) {
  test(`Smile finds the company sign-up and limit rules for: ${question}`, () => {
    const context = retrieveContext(question);
    assert.equal(context.hasMatch, true);
    assert.ok(context.sections.some((section) => section.heading === SECTION), `expected "${SECTION}" for: ${question}`);
    for (const pattern of patterns) assert.match(context.text, pattern, question);
  });
}

test("none of these questions is answered by a stale canned reply", () => {
  for (const question of Object.keys(QUESTIONS)) assert.equal(directHelpAnswer(question), null, question);
});

test("the guide states the live self-service limit, not a hardcoded guess", () => {
  assert.equal(SELF_SERVICE_MEMBER_LIMIT, 5);
  assert.match(guide, new RegExp(`starts with a limit of ${SELF_SERVICE_MEMBER_LIMIT} people`));
  // Any other "limit of N people" figure would be out of step with the code.
  const figures = [...guide.matchAll(/limit of (\d+) people/g)].map((match) => Number(match[1]));
  assert.ok(figures.length >= 2);
  for (const figure of figures) assert.equal(figure, SELF_SERVICE_MEMBER_LIMIT);
});

test("the guide has one dedicated section and no longer describes the old registration rule", () => {
  assert.ok(knowledgeHeadings().includes(SECTION));
  assert.doesNotMatch(guide, /Your email is not accepted when creating an account/);
  assert.doesNotMatch(guide, /only addresses that an\s+organisation allows can register/);
  assert.doesNotMatch(guide, /your organisation email address, and a password/);
});

test("every message people see when refused is explained to them", () => {
  for (const message of [
    "Use your work email address",
    "This email address cannot register yet",
    "This organization has reached its limit on the number of people",
  ]) assert.match(guide, new RegExp(message), message);
});

test("the guide says what counts toward a place, and that deactivating frees one", () => {
  assert.match(guide, /each invitation still waiting/);
  assert.match(guide, /each person who registered\s+but has not confirmed their email yet/);
  assert.match(guide, /Deactivating someone frees their place/);
});

test("the Drive recording folder chooser is still described with its three tabs", () => {
  assert.match(guide, /\*\*My Drive\*\*[\s\S]{0,200}\*\*Shared with\s+me\*\*[\s\S]{0,60}\*\*Shared drives\*\*/);
  const context = retrieveContext("How do I choose the Google Drive folder for Live Avatar recordings?");
  assert.ok(context.sections.some((section) => section.heading === "Recording storage for Live Avatar interviews"));
});
