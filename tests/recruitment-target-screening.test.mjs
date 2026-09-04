import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("target bulk import queues work without charging before screening", () => {
  const source = read("src/lib/recruitment-target-bulk.ts");
  assert.doesNotMatch(source, /recordDeduction/);
  assert.doesNotMatch(source, /assertCreditsAvailable/);
  assert.match(source, /status: "queued"/);
});

test("target screening executor has a dedicated authenticated process route", () => {
  const route = read("src/app/api/internal/recruitment/bulk/process/route.ts");
  const executor = read("src/lib/recruitment-target-screening.ts");
  assert.match(route, /withInternalAuth\("bulk_queue"/);
  assert.match(route, /dedupeKey_required/);
  assert.match(executor, /claimBulkQueueItem/);
  assert.match(executor, /screenResume/);
  assert.match(executor, /finalizeBulkScreening/);
});

test("screening output is strict and cannot make an HR decision", () => {
  const source = read("src/lib/recruitment-screening.ts");
  assert.match(source, /z\.literal\("For HR Review"\)/);
  assert.match(source, /interview_questions:.*length\(3\)/);
  assert.match(source, /\.strict\(\)/);
  assert.match(source, /Never approve or reject/);
});

test("result, history, queue completion, and charge share one transaction", () => {
  const queries = read("src/lib/internal-recruitment-queries.ts");
  const credits = read("src/lib/ella-credits-postgres.ts");
  assert.match(queries, /export async function finalizeBulkScreening/);
  assert.match(queries, /return db\.transaction\(async \(tx\)/);
  assert.match(queries, /appendPostgresLedgerEntryOnExecutor\(tx/);
  assert.match(queries, /status: "screened"/);
  assert.match(credits, /export async function appendPostgresLedgerEntryOnExecutor/);
});

test("failed screening marks the queue failed without a credit write", () => {
  const executor = read("src/lib/recruitment-target-screening.ts");
  const finalizeStart = executor.indexOf("const result = await finalizeBulkScreening");
  const catchStart = executor.indexOf("} catch (error)");
  assert.ok(finalizeStart > 0 && catchStart > finalizeStart);
  assert.match(executor.slice(catchStart), /status: "failed"/);
  assert.match(executor.slice(catchStart), /updateBulkQueueStatus/);
});

test("duplicate queue processing is a no-op", () => {
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(queries, /queue\.status === "screened"/);
  assert.match(queries, /duplicate: true/);
  assert.match(queries, /onConflictDoNothing\(\{ target: screeningResults\.applicationId \}\)/);
});
