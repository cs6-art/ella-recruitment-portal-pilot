import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CREDIT_LEDGER_HEADERS, CREDIT_LEDGER_TAB, creditsSpreadsheetId, creditsSpreadsheetIsFallback } from "../src/lib/ella-credits-config.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("GOOGLE_CREDITS_SPREADSHEET_ID is preferred, main workbook is the fallback", () => {
  assert.equal(creditsSpreadsheetId({ GOOGLE_CREDITS_SPREADSHEET_ID: "credits-id", GOOGLE_SHEETS_SPREADSHEET_ID: "main-id" }), "credits-id");
  assert.equal(creditsSpreadsheetId({ GOOGLE_SHEETS_SPREADSHEET_ID: "main-id" }), "main-id");
  assert.equal(creditsSpreadsheetId({}), "");
  assert.equal(creditsSpreadsheetIsFallback({ GOOGLE_SHEETS_SPREADSHEET_ID: "main-id" }), true);
  assert.equal(creditsSpreadsheetIsFallback({ GOOGLE_CREDITS_SPREADSHEET_ID: "credits-id" }), false);
});

test("the ledger tab name and A-L headers are shared by the app, backfill and parity", () => {
  assert.equal(CREDIT_LEDGER_TAB, "Ella_Credit_Ledger");
  assert.equal(CREDIT_LEDGER_HEADERS.length, 12);
  assert.equal(CREDIT_LEDGER_HEADERS[0], "Entry_ID");
  const sheets = read("src/lib/ella-credits-sheets.ts");
  assert.match(sheets, /CREDIT_LEDGER_HEADERS/);
  assert.match(sheets, /creditsSpreadsheetId\(\)/);
});

test("the parity checker gives an explicit BLOCKED message instead of an opaque range error", () => {
  const script = read("src/db/check-credit-parity.mjs");
  assert.match(script, /GOOGLE_CREDITS_SPREADSHEET_ID is not configured/);
  assert.match(script, /the '\$\{TAB\}' tab does not exist in spreadsheet/);
  assert.match(script, /Set GOOGLE_CREDITS_SPREADSHEET_ID to the workbook/);
  // still read-only, still does the full parity set
  assert.match(script, /This script made no writes/);
  assert.match(script, /no Sheet Entry_IDs missing in Postgres/);
  assert.match(script, /no duplicate IDs/);
  assert.match(script, /balances equal/);
});

test("the parity checker excludes Postgres-target-only (Scenario C) entries from sheet equality", () => {
  const script = read("src/db/check-credit-parity.mjs");
  // Target-only rows are matched by the worker actor or the target note prefix.
  assert.match(script, /actor_email = 'pilot-target-worker' or note ilike 'Postgres target %'/);
  // ...and reconciled as "Postgres leads the sheet by exactly those rows".
  assert.match(script, /pgBalance === sheetSum \+ pgTargetOnlyDelta/);
  assert.match(script, /sheetRowCount \+ pgTargetOnlyIds\.length === pgRowCount/);
  // ...never by mutating the ledger.
  assert.doesNotMatch(script, /\b(update|insert into|delete from)\b\s+"?credit_ledger/i);
  assert.match(script, /This script made no writes/);
});

test("backfill-credits also resolves the explicit credits workbook first", () => {
  const script = read("src/db/backfill-credits.mjs");
  assert.match(script, /GOOGLE_CREDITS_SPREADSHEET_ID \|\| process\.env\.GOOGLE_SHEETS_SPREADSHEET_ID/);
});

test("CREDITS_BACKEND stays dual — no cutover in this work", () => {
  const dispatcher = read("src/lib/ella-credits.ts");
  assert.match(dispatcher, /process\.env\.CREDITS_BACKEND \|\| "sheets"/);
  // no code path force-sets it to postgres
  assert.doesNotMatch(dispatcher, /CREDITS_BACKEND\s*=\s*["']postgres/);
});
