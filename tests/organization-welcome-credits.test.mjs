import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_WELCOME_CREDITS, welcomeCredits } from "../src/lib/welcome-credit-config.ts";

test("welcome credits default to 40 and can be overridden or disabled", () => {
  assert.equal(DEFAULT_WELCOME_CREDITS, 40);
  assert.equal(welcomeCredits(undefined), 40);
  assert.equal(welcomeCredits(""), 40);
  assert.equal(welcomeCredits("50"), 50);
  assert.equal(welcomeCredits("0"), 0);
});

test("an invalid welcome credit override falls back to the default", () => {
  assert.equal(welcomeCredits("-5"), 40);
  assert.equal(welcomeCredits("abc"), 40);
  assert.equal(welcomeCredits("2.5"), 40);
});
