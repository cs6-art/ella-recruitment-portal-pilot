import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  RECORDING_RETENTION_MAX_DAYS,
  RECORDING_RETENTION_MIN_DAYS,
  normalizeRecordingRetentionDays,
  recordingRetentionDaysFor,
} from "../src/lib/recording-retention.ts";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("per-organization retention accepts only whole days from 7 to 365, or blank for the platform default", () => {
  assert.equal(RECORDING_RETENTION_MIN_DAYS, 7);
  assert.equal(RECORDING_RETENTION_MAX_DAYS, 365);
  assert.equal(normalizeRecordingRetentionDays(null), null);
  assert.equal(normalizeRecordingRetentionDays(undefined), null);
  assert.equal(normalizeRecordingRetentionDays("  "), null);
  assert.equal(normalizeRecordingRetentionDays(7), 7);
  assert.equal(normalizeRecordingRetentionDays("30"), 30);
  assert.equal(normalizeRecordingRetentionDays(365), 365);
  for (const invalid of [6, 366, 7.5, -1, 0, "abc", "1e3", NaN]) {
    assert.throws(() => normalizeRecordingRetentionDays(invalid), RangeError, String(invalid));
  }
});

test("an organization's own period overrides the platform default, which applies otherwise", () => {
  assert.equal(recordingRetentionDaysFor(30, 90), 30);
  assert.equal(recordingRetentionDaysFor(null, 90), 90);
  assert.equal(recordingRetentionDaysFor(undefined, 90), 90);
  assert.equal(recordingRetentionDaysFor(null, 0), 0);
});

test("the purge checks each organization against its own period and never deletes a recording kept by default", () => {
  const store = read("src/lib/live-interview-store.ts");
  const purge = store.slice(store.indexOf("export async function purgeExpiredInterviewRecordings"));
  assert.match(purge, /innerJoin\(organizations, eq\(organizations\.id, liveInterviewSessions\.organizationId\)\)/);
  assert.match(purge, /coalesce\(\$\{organizations\.interviewRecordingRetentionDays\}, \$\{platformDays\}\)/);
  assert.match(purge, /keepsByDefault \? sql`\$\{organizations\.interviewRecordingRetentionDays\} is not null`/);
  assert.match(purge, /deleteInterviewRecording\(row\.ref, row\.organizationId, row\.accountEmail\)/);
  assert.doesNotMatch(purge, /clientTranscript|analysis:/);
});

test("the schema, migration and settings route agree on the column and its range", () => {
  assert.match(read("src/db/schema.ts"), /interviewRecordingRetentionDays: integer\("interview_recording_retention_days"\)/);
  const migration = read("drizzle/0042_organization_recording_retention.sql");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "interview_recording_retention_days" integer/);
  assert.match(migration, /BETWEEN 7 AND 365/);
  const route = read("src/app/api/organization/recording-retention/route.ts");
  assert.match(route, /user\.canEditSettings !== true/);
  assert.match(route, /normalizeRecordingRetentionDays\(body\?\.days\)/);
  assert.match(route, /where\(eq\(organizations\.id, user\.organizationId\)\)/);
});

test("the Settings card lets settings administrators set the period", () => {
  const card = read("src/components/RecordingDriveConnect.tsx");
  assert.match(card, /fetch\("\/api\/organization\/recording-retention"/);
  assert.match(card, /method: "PUT"/);
  assert.match(card, /Keep interview recordings for \(days\)/);
  assert.match(card, /min=\{7\}/);
  assert.match(card, /max=\{365\}/);
});

test("the policy pages carry the verified contact details, last-updated date and a visible back button", () => {
  for (const file of ["src/app/privacy/page.tsx", "src/app/terms/page.tsx"]) {
    const page = read(file);
    assert.match(page, /Last updated: 8 October 2026/, file);
    assert.match(page, /cs6@mclinkgroup\.com/, file);
    assert.match(page, /51 Ubi Ave 1, #05-11 Paya Ubi Industrial Park, Singapore 408933/, file);
    assert.match(page, /<Link className="btn btn-primary" href="\/">Back to the portal<\/Link>/, file);
  }
});

test("the policy pages no longer make the claims the code does not support", () => {
  const privacy = read("src/app/privacy/page.tsx");
  assert.doesNotMatch(privacy, /gpt-5-mini/);
  assert.match(privacy, /gpt-4\.1-mini/);
  assert.doesNotMatch(privacy, /unless the organization sets a different period/);
  assert.doesNotMatch(privacy, /tokens are deleted when you disconnect\./);
  assert.match(privacy, /n8n/);
  assert.match(privacy, /Recording folder connection \(organization-level\)/);
});
