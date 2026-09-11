import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applicantVoiceTimezone } from "../src/lib/applicant-timezone.ts";
import { scheduledInstant } from "../src/lib/interview-time.ts";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("local Pilot interview times are persisted as the correct UTC instant", () => {
  assert.equal(
    scheduledInstant("2026-09-10", "14:40", "Asia/Manila").toISOString(),
    "2026-09-10T06:40:00.000Z",
  );
  assert.equal(
    scheduledInstant("2026-01-15", "09:05", "Asia/Singapore").toISOString(),
    "2026-01-15T01:05:00.000Z",
  );
});

test("invalid interview date/time input is rejected", () => {
  assert.throws(() => scheduledInstant("not-a-date", "14:40", "Asia/Manila"), /Invalid interview date or time/);
  assert.throws(() => scheduledInstant("2026-09-10", "25:00", "Asia/Manila"), /Invalid interview date or time/);
});

test("voice interview timezone resolves from applicant country or phone", () => {
  assert.equal(applicantVoiceTimezone({ country: "PH" }), "Asia/Manila");
  assert.equal(applicantVoiceTimezone({ phone: "+6591234567" }), "Asia/Singapore");
  assert.equal(applicantVoiceTimezone({ country: "XX" }), "Asia/Singapore");
});

test("bulk intake creates the application before exposing a queue item to workers", () => {
  const source = read("src/lib/recruitment-target-bulk.ts");
  const applicationIndex = source.indexOf("const application = await createApplication");
  const enqueueIndex = source.indexOf("const queued = await enqueueBulkScreening");
  assert.ok(applicationIndex >= 0, "application creation must exist");
  assert.ok(enqueueIndex > applicationIndex, "queue insertion must follow application creation");
  assert.match(source.slice(enqueueIndex, enqueueIndex + 1800), /applicationExternalId: applicationId/);
  assert.match(source, /applicationId: application\.application\.id/);
});

test("bulk screening charges only after result persistence and remains idempotent", () => {
  const source = read("src/lib/internal-recruitment-queries.ts");
  const finalize = source.slice(source.indexOf("export async function finalizeBulkScreening"), source.indexOf("export async function updateBulkQueueStatus"));
  const resultInsert = finalize.indexOf("tx.insert(screeningResults)");
  const creditWrite = finalize.indexOf("appendPostgresLedgerEntryOnExecutor");
  const queueCompletion = finalize.indexOf('status: "screened"');
  assert.ok(resultInsert >= 0 && creditWrite > resultInsert, "credit write must follow screening result insertion");
  assert.ok(queueCompletion > creditWrite, "queue completion must follow the credit write");
  assert.match(finalize, /queue\.status === "screened"/);
  assert.match(finalize, /duplicate: true/);
  assert.match(finalize, /onConflictDoNothing\(\{ target: screeningResults\.applicationId \}\)/);
});

test("failed or invalid bulk screening has no credit boundary", () => {
  const intake = read("src/lib/recruitment-target-bulk.ts");
  const executor = read("src/lib/recruitment-target-screening.ts");
  assert.doesNotMatch(intake, /recordDeduction|recordVoiceInterviewDeduction|assertCreditsAvailable/);
  assert.match(executor, /status: "failed"/);
  assert.match(executor, /updateBulkQueueStatus/);
  assert.match(executor, /finalizeBulkScreening/);
});

test("bulk frontend matches Pilot queue status by job identity, not storage identity", () => {
  const panel = read("src/components/BulkResumeScreeningPanel.tsx");
  const target = read("src/lib/recruitment-target-portal.ts");
  assert.match(panel, /function queueIdentity/);
  assert.match(panel, /return item\.jobId \|\| item\.driveFileId/);
  assert.doesNotMatch(panel, /items\.find\(\(entry\) => entry\.driveFileId === queueId\)/);
  assert.match(target, /jobId: text\(item\.jobId\)/);
});

test("stale or terminal voice attempts cannot receive a result or call log", () => {
  const source = read("src/lib/internal-recruitment-queries.ts");
  const resultPath = source.slice(source.indexOf("export async function ingestVoiceResult"), source.indexOf("export async function createVoiceCallLog"));
  const logPath = source.slice(source.indexOf("export async function createVoiceCallLog"), source.indexOf("export async function hrDecisionQueue"));
  for (const section of [resultPath, logPath]) {
    assert.match(section, /const attempts =/);
    assert.match(section, /attempts\[0\]/);
    assert.match(section, /stale_attempt/);
    assert.match(section, /attempt_not_processable/);
  }
});

test("a dispatch failure/block reason is never dropped by the terminal-attempt guard it just triggered", () => {
  // Regression: failVoiceAttemptDispatch/blockVoiceAttempt flip the attempt to
  // "failed" and then log the reason via createVoiceCallLog — but that log call
  // re-reads the attempt's *current* status, so its own terminal-attempt guard
  // rejected the write and the error reason (why the call never went through)
  // was silently lost every time. allowTerminalAttempt lets these two self-caused
  // failure logs bypass that guard while webhook/replay callers still respect it.
  const source = read("src/lib/internal-recruitment-queries.ts");
  const logFn = source.slice(source.indexOf("export async function createVoiceCallLog"), source.indexOf("export async function hrDecisionQueue"));
  assert.match(logFn, /allowTerminalAttempt\?:\s*boolean/);
  assert.match(logFn, /if \(!input\.allowTerminalAttempt && \["failed", "cancelled"\]\.includes\(attempt\.status\)\)/);

  const dispatchFailFn = source.slice(source.indexOf("export async function failVoiceAttemptDispatch"), source.indexOf("export async function blockVoiceAttempt"));
  assert.match(dispatchFailFn, /allowTerminalAttempt:\s*true/);

  const blockFn = source.slice(source.indexOf("export async function blockVoiceAttempt"), source.indexOf("export async function voiceAttemptContext"));
  assert.match(blockFn, /allowTerminalAttempt:\s*true/);
});

test("voice queue expires late scheduled work before claiming it", () => {
  const source = read("src/lib/internal-recruitment-queries.ts");
  const claim = source.slice(source.indexOf("export async function claimVoiceCalls"), source.indexOf("export async function pendingVoiceCalls"));
  const pending = source.slice(source.indexOf("export async function pendingVoiceCalls"), source.indexOf("export async function dispatchVoiceAttemptDryRun"));
  for (const section of [claim, pending]) {
    assert.match(section, /status = 'failed'/);
    assert.match(section, /outcome = 'system_failure'/);
    assert.match(section, /VOICE_CALL_MAX_LATE_MINUTES/);
  }
  assert.match(claim, /FOR UPDATE SKIP LOCKED/);
});
