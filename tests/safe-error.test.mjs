import assert from "node:assert/strict";
import test from "node:test";

import { safeErrorResponse } from "../src/lib/safe-error.ts";

const quiet = (fn) => { const original = console.error; console.error = () => {}; try { return fn(); } finally { console.error = original; } };

test("raw SQL errors are replaced with the fallback text", () => {
  const error = new Error('Failed query: insert into "bookings" ("id") values ($1) params: abc');
  const safe = quiet(() => safeErrorResponse(error, "Unable to reserve this interview slot."));
  assert.equal(safe.message, "Unable to reserve this interview slot.");
  assert.doesNotMatch(safe.message, /insert|\$1|params/i);
});

test("quota failures become a friendly 503", () => {
  const safe = quiet(() => safeErrorResponse(new Error("Quota exceeded for quota metric 'Read requests'"), "x"));
  assert.equal(safe.status, 503);
  assert.equal(safe.code, "service_quota");
});

test("business-rule messages pass through unchanged", () => {
  const safe = safeErrorResponse(new Error("This AI Voice Interview time has reached the maximum of 10 concurrent calls. Choose another time."), "x");
  assert.equal(safe.status, 400);
  assert.match(safe.message, /maximum of 10 concurrent calls/);
});
