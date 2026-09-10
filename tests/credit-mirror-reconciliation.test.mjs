import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// --- Dual-write ordering + recovery ----------------------------------------

test("dual mode writes the authoritative Sheet before the Postgres mirror", () => {
  const src = read("src/lib/ella-credits.ts");
  // Sheet append is awaited first; the mirror runs only after it resolves.
  assert.match(src, /const \{ balanceAfter \} = await appendSheetLedgerEntry\(entry\);\s*\n\s*if \(backend === "dual"\) await mirrorToPostgres\(entry\);/);
});

test("a failed Postgres mirror is caught, does not throw, and is logged with the source id for replay", () => {
  const src = read("src/lib/ella-credits.ts");
  const mirror = src.slice(src.indexOf("async function mirrorToPostgres"), src.indexOf("// --- Reads"));
  assert.match(mirror, /try \{/);
  assert.match(mirror, /catch \(error\) \{/);
  // structured, greppable marker + the exact entry identity
  assert.match(mirror, /\[Credits\]\[mirror-miss\]/);
  assert.match(mirror, /\$\{entry\.sourceEntryId\}/);
  // it swallows the error (best-effort) — no re-throw in the catch
  assert.doesNotMatch(mirror, /catch \(error\) \{[^}]*throw/s);
  // and points at the safe, idempotent recovery paths
  assert.match(mirror, /db:check:credits/);
  assert.match(mirror, /db:backfill:credits/);
});

test("a retry of the same logical charge reuses one billing identity on both stores", () => {
  const src = read("src/lib/ella-credits.ts");
  // deterministic id from the caller key
  assert.match(src, /return `LDG-\$\{crypto\.createHash\("sha256"\)\.update\(key\)\.digest\("hex"\)\}`/);
  // Sheets dedupes on entryId, Postgres dedupes on source_entry_id
  assert.match(read("src/lib/ella-credits-sheets.ts"), /row\.entryId === entry\.sourceEntryId/);
  assert.match(read("src/lib/ella-credits-postgres.ts"), /select exists\(select 1 from "credit_ledger" where "source_entry_id" = \$\{entry\.sourceEntryId\}\)/);
});

// --- check-credit-parity: categorised reconciliation report ----------------

test("db:check:credits reports every requested reconciliation category", () => {
  const script = read("src/db/check-credit-parity.mjs");
  assert.match(script, /Sheet rows missing from the Postgres ledger/);
  assert.match(script, /Postgres rows missing from the Sheet mirror/);
  assert.match(script, /Scenario C \(target-only, by design\)/);
  assert.match(script, /awaiting Sheet mirror \(needs review\)/);
  assert.match(script, /Balance differences/);
  assert.match(script, /Duplicate source ids/);
  assert.match(script, /Unresolved partial writes \(NULL source id\)/);
});

test("db:check:credits treats a reconciling-but-unmirrored ledger as PASS WITH WARNINGS, not FAIL", () => {
  const script = read("src/db/check-credit-parity.mjs");
  // hard failures: lost authoritative write, dupes, nulls, arithmetic break
  assert.match(script, /H1 no Sheet rows missing from the immutable Postgres ledger/);
  assert.match(script, /H4 balances reconcile/);
  assert.match(script, /const warn = pgOnlyUnmirrored\.length > 0;/);
  assert.match(script, /PASS WITH WARNINGS/);
  // exit non-zero only on a hard assertion failure
  assert.match(script, /process\.exit\(ok \? 0 : 1\)/);
  // it still never writes
  assert.doesNotMatch(script, /\b(update|insert into|delete from|values\.append|values\.update)\b/i);
  assert.match(script, /This script made no writes/);
});

test("db:check:credits balance identity is arithmetic, not sheet==pg row equality", () => {
  const script = read("src/db/check-credit-parity.mjs");
  assert.match(script, /pgBalance === pgDeltaSum && pgDeltaSum === sheetSum \+ pgOnlyDelta/);
  // both Scenario C and not-yet-mirrored deltas are in pgOnlyDelta
  assert.match(script, /const pgOnlyDelta = deltaOf\(pgOnlyIds\);/);
});

// --- reconcile-credit-sheet-mirror: safe idempotent repair ----------------

test("reconcile-credit-sheet-mirror is dry-run by default and needs --commit to write", () => {
  const script = read("src/db/reconcile-credit-sheet-mirror.mjs");
  assert.match(script, /const commit = args\.has\("--commit"\)/);
  assert.match(script, /if \(!commit\) \{/);
  assert.match(script, /Dry run only\./);
  // read-only Sheets scope unless committing
  assert.match(script, /commit \? "https:\/\/www\.googleapis\.com\/auth\/spreadsheets" : "https:\/\/www\.googleapis\.com\/auth\/spreadsheets\.readonly"/);
});

test("reconcile-credit-sheet-mirror never re-charges and never touches credit_balance or Postgres", () => {
  const script = read("src/db/reconcile-credit-sheet-mirror.mjs");
  assert.doesNotMatch(script, /\brecord(Deduction|TopUp|VoiceInterviewDeduction)\(/);
  assert.doesNotMatch(script, /(insert into|update)\s+["']?credit_balance/i);
  // the only Postgres statement is a SELECT
  assert.doesNotMatch(script, /\b(insert into|update|delete from)\b/i);
  assert.match(script, /from credit_ledger\s*\n\s*where source_entry_id is not null/);
  // Sheets writes are append-only (no values.update / no row edits)
  assert.doesNotMatch(script, /values\.update/);
  assert.match(script, /values\.append/);
});

test("reconcile-credit-sheet-mirror is idempotent and refuses the dangerous direction", () => {
  const script = read("src/db/reconcile-credit-sheet-mirror.mjs");
  // skip rows already present in the Sheet, re-checked per row to close races
  assert.match(script, /if \(present\.has\(id\)\) \{/);
  assert.match(script, /skip \(already in Sheet\)/);
  // refuse if a Sheet row is missing from the immutable Postgres ledger
  assert.match(script, /if \(sheetOnly\.length > 0\) \{/);
  assert.match(script, /a human must investigate a lost authoritative write/);
});

test("reconcile-credit-sheet-mirror scopes to manual rows by default, Scenario C only on request", () => {
  const script = read("src/db/reconcile-credit-sheet-mirror.mjs");
  assert.match(script, /const includeScenarioC = args\.has\("--include-scenario-c"\)/);
  assert.match(script, /if \(!includeScenarioC && !onlyId\) candidates = candidates\.filter\(\(r\) => !isScenarioC\(r\)\)/);
  assert.match(script, /--only=/);
});

// --- check-recruitment-parity: superseded post-cutover --------------------

test("db:check:recruitment is superseded by default and points at the integrity check", () => {
  const script = read("src/db/check-recruitment-parity.mjs");
  assert.match(script, /const forceLegacy = process\.argv\.includes\("--legacy-parity"\)/);
  assert.match(script, /if \(!forceLegacy\) \{/);
  assert.match(script, /SUPERSEDED/);
  assert.match(script, /db:check:recruitment:integrity/);
  assert.match(script, /process\.exit\(0\)/);
});

test("db:check:recruitment --legacy-parity resolves tabs by probing both workbooks", () => {
  const script = read("src/db/check-recruitment-parity.mjs");
  // no fixed tab->file map; probe the configured workbooks and index tab titles
  assert.match(script, /const workbookCandidates = \[\.\.\.new Set\(\[mainId, rolesId\]\.filter\(Boolean\)\)\]/);
  assert.match(script, /async function tabIndex\(\)/);
  assert.match(script, /spreadsheets\.get\(\{ spreadsheetId, fields: "sheets\.properties\.title" \}\)/);
  // a genuinely missing tab names the migration and the integrity check
  assert.match(script, /was not found in any configured workbook/);
  assert.match(script, /db:check:recruitment:integrity/);
  // still read-only
  assert.doesNotMatch(script, /\b(insert into|update\s+|delete from|truncate)\b/i);
});
