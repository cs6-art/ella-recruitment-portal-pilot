import assert from "node:assert/strict";
import test from "node:test";

import { creditPacks, findCreditPack, resetCreditPackCache } from "../src/lib/credit-packs.ts";

test("built-in catalog has usable packs with server-side pricing", () => {
  resetCreditPackCache();
  delete process.env.ELLA_CREDIT_PACKS;
  const packs = creditPacks();
  assert.ok(packs.length >= 1);
  for (const pack of packs) {
    assert.ok(pack.credits > 0 && Number.isInteger(pack.credits));
    assert.ok(pack.amountCents > 0 && Number.isInteger(pack.amountCents));
    assert.match(pack.currency, /^[A-Z]{3}$/);
  }
});

test("findCreditPack resolves by id, case-insensitively, and rejects unknown", () => {
  resetCreditPackCache();
  delete process.env.ELLA_CREDIT_PACKS;
  assert.equal(findCreditPack("STARTER")?.id, "starter");
  assert.equal(findCreditPack("does-not-exist"), undefined);
  // client cannot smuggle a price/credits — only an id is looked up
  assert.equal(findCreditPack("starter\";credits=999999"), undefined);
});

test("a valid ELLA_CREDIT_PACKS override replaces the catalog", () => {
  resetCreditPackCache();
  process.env.ELLA_CREDIT_PACKS = JSON.stringify([{ id: "x", credits: 10, amountCents: 100, currency: "USD" }]);
  const packs = creditPacks();
  assert.equal(packs.length, 1);
  assert.equal(packs[0].credits, 10);
  resetCreditPackCache();
  delete process.env.ELLA_CREDIT_PACKS;
});

test("a malformed override is ignored and the built-in catalog is kept", () => {
  resetCreditPackCache();
  process.env.ELLA_CREDIT_PACKS = JSON.stringify([{ id: "x", credits: -5, amountCents: 100, currency: "USD" }]);
  assert.ok(creditPacks().length >= 1);
  assert.notEqual(creditPacks()[0].credits, -5);
  resetCreditPackCache();
  delete process.env.ELLA_CREDIT_PACKS;
});
