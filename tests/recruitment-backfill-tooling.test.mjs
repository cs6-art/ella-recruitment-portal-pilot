import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("recruitment backfill keeps pilot workbook ownership explicit", () => {
  const source = read("src/db/backfill-recruitment.mjs");
  assert.match(source, /const WORKBOOKS = \{ main: mainSpreadsheetId, roles: rolesSpreadsheetId \}/);
  assert.match(source, /readTab\("roles", "Role_Requests"\)/);
  assert.match(source, /readTab\("main", "High_Match_Profile"\)/);
  assert.match(source, /replaceAll\("'", "''"\).*!A:ZZ/s);
});

test("recruitment backfill is dry-run by default and records journals only on commit", () => {
  const source = read("src/db/backfill-recruitment.mjs");
  assert.match(source, /const commit = args\.has\("--commit"\)/);
  assert.match(source, /if \(commit\).*_backfill_journal/s);
  assert.match(source, /--only=all/);
});

test("recruitment backfill audits final interview and voice logs without writing them", () => {
  const source = read("src/db/backfill-recruitment.mjs");
  assert.match(source, /historical_unknown/);
  assert.match(source, /relatedHistory/);
  assert.match(source, /Voice_Call_Logs/);
  assert.match(source, /destinationPending/);
  assert.match(source, /historical_placeholders/);
  assert.match(source, /voice_logs requires 0004/);
});

test("recruitment parity is read-only and supports explicit domains", () => {
  const source = read("src/db/check-recruitment-parity.mjs");
  assert.match(source, /--only=/);
  assert.match(source, /spreadsheets\.values\.get/);
  assert.doesNotMatch(source, /insert into|update\s+|delete from|truncate/i);
  assert.match(source, /voice_results: '"voice_interview_results"'/);
});

test("mapping documents applicant identity and deferred configuration decisions", () => {
  const doc = read("docs/RECRUITMENT-BACKFILL-MAPPING.md");
  assert.match(doc, /Application ID/);
  assert.match(doc, /normalized email/);
  assert.match(doc, /plaintext tokens/);
  assert.match(doc, /Final_Interview_Tracking/);
});
