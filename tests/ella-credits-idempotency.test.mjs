import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("recordDeduction and recordTopUp accept a stable idempotencyKey", () => {
  const src = read("src/lib/ella-credits.ts");
  assert.match(src, /idempotencyKey\?: string/);
  // deterministic sourceEntryId derived from the key, namespaced so random
  // uuid keys never collide with it
  assert.match(src, /function newSourceEntryId\(idempotencyKey\?: string\)/);
  assert.match(src, /createHash\("sha256"\)\.update\(key\)\.digest\("hex"\)/);
  // recordTopUp threads the key through, and keys the volume-discount bonus row
  assert.match(src, /newSourceEntryId\(input\.idempotencyKey\)/);
  assert.match(src, /`\$\{input\.idempotencyKey\}:bonus`/);
});

test("the Sheets ledger append is idempotent on a repeated sourceEntryId", () => {
  const src = read("src/lib/ella-credits-sheets.ts");
  assert.match(src, /existing\.find\(\(row\) => row\.entryId === entry\.sourceEntryId\)/);
  assert.match(src, /if \(prior\) \{/);
  assert.match(src, /applied: false/);
});

test("the Postgres store was already idempotent on source_entry_id (unchanged)", () => {
  const src = read("src/lib/ella-credits-postgres.ts");
  assert.match(src, /where "source_entry_id" = \$\{entry\.sourceEntryId\}/);
});

test("the manual top-up API sends a stable idempotency key and requires a positive amount + reason", () => {
  const route = read("src/app/api/ella-credits/route.ts");
  assert.match(route, /\.positive\(/);
  assert.match(route, /min\(1, "A reason is required\."\)/);
  assert.match(route, /idempotencyKey/);
  assert.match(route, /event: "manual_topup"/);
});

test("credit deductions carry a caller idempotency key on the bulk path", () => {
  // The bulk intake path charges once per screened file; the queueId is a
  // natural stable key. (recordDeduction already dedupes the mirror; the key
  // makes a caller-level retry safe too.)
  const intake = read("src/lib/bulk-resume-intake.ts");
  assert.match(intake, /recordDeduction\(/);
  assert.match(intake, /idempotencyKey: `cv:\$\{resolvedQueueId\}`/);
});
