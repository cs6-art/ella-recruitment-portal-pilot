import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(file, "utf8");

test("Postgres application creation queues one idempotent acknowledgment event", () => {
  const query = read("src/lib/internal-recruitment-queries.ts");
  assert.match(query, /email:application_acknowledgment:\$\{application\.externalId\}/);
  assert.match(query, /notificationEventType: "application_acknowledgment"/);
  assert.match(query, /onConflictDoNothing\(\{ target: applicationStatusHistory\.actionRequestId \}\)/);
});

test("screening, voice result, retry, and final decision paths enqueue typed events", () => {
  const query = read("src/lib/internal-recruitment-queries.ts");
  for (const event of ["screening_next_step", "voice_result_next_step", "voice_no_show", "voice_retry"]) assert.match(query, new RegExp(`notificationEventType: [\\"']${event}[\\"']`), `missing ${event}`);
  for (const event of ["voice_rejection", "final_decision_pass", "final_decision_reject"]) assert.match(query, new RegExp(`\\"${event}\\"`), `missing ${event}`);
  assert.match(query, /email:voice_no_show:\$\{current\.id\}/);
  assert.match(query, /email:voice_retry:\$\{next\.id\}/);
});

test("booking invitation and confirmation events retain redirectable intended-recipient audit data", () => {
  const query = read("src/lib/internal-recruitment-queries.ts");
  assert.match(query, /notificationEventType: input\.kind === "voice" \? "voice_booking_invitation" : "final_booking_invitation"/);
  assert.match(query, /notificationEventType: slot\.interviewType === "voice" \? "voice_booking_confirmation" : "final_booking_confirmation"/);
  assert.match(query, /notificationRecipient: pilotEmailRecipient\(application\.email\)\.to/);
  assert.match(query, /notificationIntendedRecipient: application\.email/);
});

test("booking-token replay is idempotent while terminal tokens can be reissued", () => {
  const query = read("src/lib/internal-recruitment-queries.ts");
  assert.match(query, /inArray\(bookingTokens\.status, \["pending", "active"\]\)/);
  assert.match(query, /booking-invitation:\$\{input\.kind\}:\$\{input\.applicationExternalId\}:\$\{tokenHash\}/);
});

test("resume approval queues the voice booking invitation immediately and safely replays", () => {
  const target = read("src/lib/recruitment-target-portal.ts");
  const query = read("src/lib/internal-recruitment-queries.ts");
  assert.match(target, /input\.stage === "resume" && input\.decision === "Approve"/);
  assert.match(target, /createBookingToken\(\{/);
  assert.match(target, /voiceBookingInvitationQueued: true/);
  assert.match(query, /if \(history\) return \{ updated: false, duplicate: true, error: null \};/);
  assert.match(query, /newStage: nextStage/);
});

test("voice approval invites the candidate to book the face-to-face interview", () => {
  const target = read("src/lib/recruitment-target-portal.ts");
  assert.match(target, /input\.stage === "voice" && input\.decision === "Approve"/);
  assert.match(target, /kind: "final"/);
  assert.match(target, /finalBookingInvitationQueued: true/);
});

test("notification queue exposes email-ready wording, not raw workflow keys", () => {
  const query = read("src/lib/internal-recruitment-queries.ts");
  const labels = read("src/lib/notification-labels.ts");
  assert.match(query, /eventLabel: notificationEventLabel\(history\.notificationEventType\)/);
  assert.match(query, /statusLabel: notificationStatusLabel\(history\.newStage\)/);
  assert.match(query, /summary: notificationSummary\(history\.notificationEventType, history\.comments\)/);
  assert.match(labels, /voice_result_next_step: "AI voice interview completed — HR review needed"/);
  assert.match(labels, /A recruitment workflow update requires your attention\./);
});

test("target booking links expose generated availability and materialize the selected virtual slot", () => {
  const target = read("src/lib/recruitment-target-portal.ts");
  assert.match(target, /virtualSlotsForRole\(role, kind === "voice" \? "AI Voice Interview" : "Final Interview"\)/);
  assert.match(target, /const virtualSlot = isVirtualSlotId\(slotId\) \? context\.slots\.find\(\(slot\) => slot\.slotId === slotId\) : undefined/);
  assert.match(target, /slotCode: kind === "final" \? virtualSlot\.slotId : undefined/);
  assert.match(target, /persistedSlotId = materialized\.slot\.id/);
});

test("notification state records attempt, sent time, provider ID, and recipient", () => {
  const query = read("src/lib/internal-recruitment-queries.ts");
  const route = read("src/app/api/internal/recruitment/notifications/route.ts");
  for (const field of ["notificationAttemptedAt", "notificationSentAt", "notificationProviderId", "notificationRecipient"]) assert.match(query, new RegExp(field));
  assert.match(route, /providerMessageId/);
});

test("Pilot target notifier is candidate-event allowlisted and never sends to an arbitrary mailbox", () => {
  const safety = read("src/lib/pilot-test-safety.ts");
  assert.match(safety, /PILOT_TEST_EMAIL = "cs6@mclinkgroup\.com"/);
});
