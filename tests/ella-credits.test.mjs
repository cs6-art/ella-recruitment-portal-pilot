import assert from "node:assert/strict";
import test from "node:test";

import {
  assertBalanceCovers,
  CREDIT_COST,
  creditsRequired,
  EllaCreditsError,
  LIVE_AVATAR_MAX_CREDITS,
  liveAvatarCreditsForSeconds,
  summarizeLedger,
} from "../src/lib/ella-credit-math.ts";

test("default credit costs match the Ella pricing model", () => {
  assert.equal(CREDIT_COST.cv_analysis, 1);
  assert.equal(CREDIT_COST.phone_interview, 10);
});

test("creditsRequired multiplies units by the per-unit cost", () => {
  assert.equal(creditsRequired(3, CREDIT_COST.cv_analysis), 3);
  assert.equal(creditsRequired(2, CREDIT_COST.phone_interview), 20);
  assert.equal(creditsRequired(4, 5), 20); // overridden cost
  assert.equal(creditsRequired(0, 10), 0);
  assert.equal(creditsRequired(-5, 1), 0);
});

test("balance is the signed sum of every ledger row", () => {
  const summary = summarizeLedger([
    { creditsDelta: 15 },
    { creditsDelta: -1 },
    { creditsDelta: -10 },
    { creditsDelta: 100 },
    { creditsDelta: -50 },
  ]);
  assert.equal(summary.toppedUp, 115);
  assert.equal(summary.consumed, 61);
  assert.equal(summary.balance, 54);
});

test("assertBalanceCovers passes when the balance exactly covers the spend", () => {
  assert.equal(assertBalanceCovers(10, 1, 10), 0);
  assert.equal(assertBalanceCovers(12, 3, 1), 9);
});

test("assertBalanceCovers throws EllaCreditsError when short", () => {
  assert.throws(() => assertBalanceCovers(9, 1, 10), (error) => {
    assert.ok(error instanceof EllaCreditsError);
    assert.equal(error.code, "INSUFFICIENT_CREDITS");
    assert.equal(error.required, 10);
    assert.equal(error.available, 9);
    return true;
  });
  assert.throws(() => assertBalanceCovers(2, 3, 1), EllaCreditsError);
});

test("Live Avatar interviews are billed per started minute, minimum one, capped at 20", () => {
  assert.equal(CREDIT_COST.live_avatar_interview, 2);
  assert.equal(LIVE_AVATAR_MAX_CREDITS, 40);
  assert.equal(liveAvatarCreditsForSeconds(1), 2); // 1 second still bills the one-minute minimum
  assert.equal(liveAvatarCreditsForSeconds(60), 2);
  assert.equal(liveAvatarCreditsForSeconds(61), 4); // every started minute counts
  assert.equal(liveAvatarCreditsForSeconds(5 * 60), 10);
  assert.equal(liveAvatarCreditsForSeconds(20 * 60), 40);
  assert.equal(liveAvatarCreditsForSeconds(45 * 60), 40); // never above the 20-minute cap
  assert.equal(liveAvatarCreditsForSeconds(null), 2); // unknown duration bills the minimum
  assert.equal(liveAvatarCreditsForSeconds(Number.NaN), 2);
  assert.equal(liveAvatarCreditsForSeconds(-30), 2);
});
