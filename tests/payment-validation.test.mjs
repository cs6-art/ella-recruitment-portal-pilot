import assert from "node:assert/strict";
import test from "node:test";

import { isPaymentEventDedupeConflict, parseProviderAmountCents } from "../src/lib/payment-validation.ts";

test("payment amount validation rejects missing, malformed, and non-numeric amounts", () => {
  assert.equal(parseProviderAmountCents("50.00"), 5000);
  for (const amount of [undefined, null, "", "50.000", "50e0", "abc", "-50.00"]) {
    assert.equal(parseProviderAmountCents(amount), null, `must reject ${String(amount)}`);
  }
});

test("only a payment_events dedupe unique violation is a duplicate replay", () => {
  assert.equal(isPaymentEventDedupeConflict({ code: "23505", constraint: "payment_events_dedupe_key_key" }), true);
  assert.equal(isPaymentEventDedupeConflict({ code: "23505", constraint: "payments_reference_key" }), false);
  assert.equal(isPaymentEventDedupeConflict({ code: "ECONNRESET", constraint: "payment_events_dedupe_key_key" }), false);
  assert.equal(isPaymentEventDedupeConflict(new Error("database unavailable")), false);
});
