import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Drizzle schema defines the credit ledger + balance tables", () => {
  const schema = read("src/db/schema.ts");
  assert.match(schema, /pgTable\(\s*"credit_ledger"/);
  assert.match(schema, /pgTable\("credit_balance"/);
  assert.match(schema, /source_entry_id.*\.unique\(\)/s);
  assert.match(schema, /credit_ledger_entry_time_idx/);
});

test("migration SQL creates both tables and seeds the single balance row", () => {
  const sql = read("drizzle/0001_init_credit_ledger.sql");
  assert.match(sql, /create table if not exists "credit_ledger"/i);
  assert.match(sql, /create table if not exists "credit_balance"/i);
  assert.match(sql, /"source_entry_id" text unique/i);
  assert.match(sql, /insert into "credit_balance" \("id", "balance"\) values \(1, 0\)\s*on conflict/i);
});

test("the Postgres append is atomic and guards deductions against going negative", () => {
  const store = read("src/lib/ella-credits-postgres.ts");
  // one statement: update balance + insert ledger in the same CTE
  assert.match(store, /with existed as/);
  assert.match(store, /update "credit_balance"/);
  assert.match(store, /insert into "credit_ledger"/);
  // the guard only applies when options.guard is true
  assert.match(store, /options\.guard \? sql` and "credit_balance"\."balance" \+ \$\{delta\} >= 0`/);
  // idempotent on source_entry_id
  assert.match(store, /where "source_entry_id" = \$\{entry\.sourceEntryId\}/);
  assert.match(store, /throw new EllaCreditsError/);
});

test("CREDITS_BACKEND defaults to sheets and needs DATABASE_URL for the others", () => {
  const dispatcher = read("src/lib/ella-credits.ts");
  assert.match(dispatcher, /process\.env\.CREDITS_BACKEND \|\| "sheets"/);
  assert.match(dispatcher, /if \(!isDatabaseConfigured\(\)\) \{[\s\S]*?return "sheets";/);
  // dual mirrors best-effort and never lets a Postgres failure break the request
  assert.match(dispatcher, /Postgres mirror write failed \(Sheets remains authoritative\)/);
  assert.match(dispatcher, /appendPostgresLedgerEntry\(entry, \{ guard: false \}\)/);
});

test("the public credits API surface is unchanged", () => {
  const dispatcher = read("src/lib/ella-credits.ts");
  for (const name of ["getCreditBalance", "assertCreditsAvailable", "recordDeduction", "recordTopUp", "getCreditPricing", "creditCostFor", "volumeDiscountBonus"]) {
    assert.match(dispatcher, new RegExp(`export async function ${name}\\b`), `missing export ${name}`);
  }
  assert.match(dispatcher, /export \{ CREDIT_COST, EllaCreditsError \}/);
});

test("db client is lazy — no connection at import", () => {
  const client = read("src/db/client.ts");
  assert.match(client, /let cached: NeonHttpDatabase<typeof schema> \| null = null/);
  assert.match(client, /export function getDb\(\)/);
  assert.doesNotMatch(client, /^const db = drizzle/m);
});

test("the candidate-application webhook is bounded by a timeout", () => {
  const workflow = read("src/lib/applicant-workflow.ts");
  assert.match(workflow, /N8N_CANDIDATE_APPLICATION_TIMEOUT_MS/);
  assert.match(workflow, /new AbortController\(\)/);
  assert.match(workflow, /signal: controller\.signal/);
});
