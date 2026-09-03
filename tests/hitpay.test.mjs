import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  hitpayApiBase,
  hitpayMode,
  isHitpayConfigured,
  mapHitpayStatus,
  verifyFormWebhook,
  verifyJsonWebhook,
} from "../src/lib/hitpay.ts";
import { parseProviderAmountCents } from "../src/lib/payment-validation.ts";

const SALT = "test-salt-abcdef0123456789";

function withSalt(fn) {
  const prev = process.env.HITPAY_SALT;
  process.env.HITPAY_SALT = SALT;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.HITPAY_SALT;
    else process.env.HITPAY_SALT = prev;
  }
}

test("isHitpayConfigured needs both key and salt", () => {
  const key = process.env.HITPAY_API_KEY;
  const salt = process.env.HITPAY_SALT;
  delete process.env.HITPAY_API_KEY;
  delete process.env.HITPAY_SALT;
  assert.equal(isHitpayConfigured(), false);
  process.env.HITPAY_API_KEY = "k";
  assert.equal(isHitpayConfigured(), false);
  process.env.HITPAY_SALT = "s";
  assert.equal(isHitpayConfigured(), true);
  if (key === undefined) delete process.env.HITPAY_API_KEY; else process.env.HITPAY_API_KEY = key;
  if (salt === undefined) delete process.env.HITPAY_SALT; else process.env.HITPAY_SALT = salt;
});

test("default mode is sandbox and the base URL is the sandbox host", () => {
  const prev = process.env.HITPAY_MODE;
  delete process.env.HITPAY_MODE;
  delete process.env.HITPAY_API_URL;
  assert.equal(hitpayMode(), "sandbox");
  assert.match(hitpayApiBase(), /api\.sandbox\.hit-pay\.com/);
  process.env.HITPAY_MODE = "live";
  assert.equal(hitpayMode(), "live");
  assert.match(hitpayApiBase(), /api\.hit-pay\.com/);
  if (prev === undefined) delete process.env.HITPAY_MODE; else process.env.HITPAY_MODE = prev;
});

test("an explicit HitPay API URL is already a versioned base", () => {
  const previous = process.env.HITPAY_API_URL;
  process.env.HITPAY_API_URL = "https://api.sandbox.hit-pay.com/v1";
  assert.equal(hitpayApiBase(), "https://api.sandbox.hit-pay.com/v1");
  if (previous === undefined) delete process.env.HITPAY_API_URL; else process.env.HITPAY_API_URL = previous;
});

test("classic form webhook verifies a correctly salted HMAC and rejects tampering", () => {
  withSalt(() => {
    const fields = { payment_id: "abc", amount: "50.00", currency: "SGD", status: "completed", reference_number: "PAY-1" };
    const base = Object.keys(fields).sort().map((k) => `${k}${fields[k]}`).join("");
    const hmac = crypto.createHmac("sha256", SALT).update(base).digest("hex");

    assert.equal(verifyFormWebhook({ ...fields, hmac }), true);
    assert.equal(verifyFormWebhook({ ...fields, amount: "5000.00", hmac }), false, "amount tamper rejected");
    assert.equal(verifyFormWebhook({ ...fields }), false, "missing hmac rejected");
    assert.equal(verifyFormWebhook({ ...fields, hmac: "deadbeef" }), false, "wrong hmac rejected");
  });
});

test("JSON webhook verifies a raw-body HMAC header", () => {
  withSalt(() => {
    const raw = JSON.stringify({ status: "completed", reference_number: "PAY-2", amount: "10.00" });
    const sig = crypto.createHmac("sha256", SALT).update(raw, "utf8").digest("hex");
    assert.equal(verifyJsonWebhook(raw, sig), true);
    assert.equal(verifyJsonWebhook(raw, null), false);
    assert.equal(verifyJsonWebhook(raw + " ", sig), false);
  });
});

test("status vocabulary maps to our states", () => {
  assert.equal(mapHitpayStatus("completed"), "paid");
  assert.equal(mapHitpayStatus("paid"), "paid");
  assert.equal(mapHitpayStatus("failed"), "failed");
  assert.equal(mapHitpayStatus("expired"), "expired");
  assert.equal(mapHitpayStatus("pending"), "pending");
  assert.equal(mapHitpayStatus("weird"), "pending");
});

test("provider amounts must be strict positive two-decimal major-unit strings", () => {
  assert.equal(parseProviderAmountCents("50.00"), 5000);
  assert.equal(parseProviderAmountCents("50"), 5000);
  for (const value of ["", " ", "50.000", "50e0", "+50.00", "-50.00", "0", "0.00", "abc", null, 50]) {
    assert.equal(parseProviderAmountCents(value), null, `rejected ${String(value)}`);
  }
  assert.equal(parseProviderAmountCents("50.01"), 5001);
});
