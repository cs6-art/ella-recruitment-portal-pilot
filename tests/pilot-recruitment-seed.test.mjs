import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("pilot recruitment reset is explicit, pilot-gated, FK-ordered, and protects credits/payments", () => {
  const source = read("src/db/reset-recruitment-pilot.mjs");
  assert.match(source, /--confirm-pilot-reset/);
  assert.match(source, /weathered-haze-aukfuaij/);
  assert.match(source, /credit_ledger/);
  assert.match(source, /_migrations/);
  assert.match(source, /sql\.transaction/);
  assert.doesNotMatch(source, /delete from "credit_|delete from "payments|delete from "payment_events|delete from "_migrations/i);
});

test("pilot dummy seed is synthetic, empty-database-gated, and leaves credits/payments untouched", () => {
  const source = read("src/db/seed-pilot-dummy-recruitment.mjs");
  assert.match(source, /--confirm-pilot-seed/);
  assert.match(source, /example\.invalid/);
  for (const scenario of ["normal_success", "no_show_retry", "bulk_drive"]) assert.match(source, new RegExp(scenario));
  assert.match(source, /voice_call_logs/);
  assert.doesNotMatch(source, /insert into\s+credit_|insert into\s+payments|update\s+credit_|update\s+payments/i);
});
