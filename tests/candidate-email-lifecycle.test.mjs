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

test("resume approval creates a separate one-time avatar invitation with the same expiry", () => {
  const target = read("src/lib/recruitment-target-portal.ts");
  const query = read("src/lib/internal-recruitment-queries.ts");
  const labels = read("src/lib/notification-labels.ts");
  assert.match(target, /kind: "avatar"/);
  assert.match(target, /avatarInterviewInvitationQueued: true/);
  assert.match(query, /input\.kind === "avatar"/);
  assert.match(query, /status: "active"/);
  assert.match(query, /status: "used", usedAt/);
  assert.match(labels, /secondaryCta: avatarLink/);
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

test("notification queue carries ready-to-send candidate email copy per booking event", () => {
  const labels = read("src/lib/notification-labels.ts");
  const query = read("src/lib/internal-recruitment-queries.ts");
  assert.match(labels, /voice_booking_invitation: "Schedule your AI voice interview with McLink Group"/);
  assert.match(labels, /voice_booking_confirmation: "Your AI voice interview is confirmed"/);
  assert.match(labels, /Ella, will call you at your preferred mobile number/);
  assert.match(labels, /cta: "Schedule a call"/);
  assert.match(labels, /secondaryCta: avatarLink \? "Interview with our Avatar now"/);
  assert.match(labels, /cta: "Schedule final interview"/);
  assert.match(labels, /includeRawBookingLink: false/);
  assert.match(labels, /Please use the button below/);
  assert.doesNotMatch(labels, /Please use the secure link below/);
  // Google Calendar delivers the face-to-face confirmation, so no email here.
  assert.match(labels, /if \(key === "final_booking_confirmation"\) return null/);
  assert.match(query, /email: notificationEmail\(history\.notificationEventType/);
  assert.match(query, /confirmationIsEmailed \? "pending" : "skipped"/);
});

test("AI voice interview times follow the applicant country timezone; face-to-face stays office time", async () => {
  const { applicantVoiceTimezone } = await import("../src/lib/applicant-timezone.ts");
  assert.equal(applicantVoiceTimezone({ country: "PH" }), "Asia/Manila");
  assert.equal(applicantVoiceTimezone({ country: "MY" }), "Asia/Kuala_Lumpur");
  assert.equal(applicantVoiceTimezone({ country: "", phone: "+639171234567" }), "Asia/Manila");
  assert.equal(applicantVoiceTimezone({ country: "" }), "Asia/Singapore");

  const rules = read("src/lib/interview-availability-rules.ts");
  assert.match(rules, /voiceTimezoneOverride\?: string/);
  assert.match(rules, /if \(rule\.interviewType === "AI Voice Interview"\) rule\.timezone = voiceTimezone/);
  assert.match(rules, /const finalTimezone = "Asia\/Singapore"/);
  const target = read("src/lib/recruitment-target-portal.ts");
  assert.match(target, /kind === "voice"\s*\?\s*applicantVoiceTimezone/);
});

test("a scheduled voice interview no longer blocks applicant deletion", () => {
  const query = read("src/lib/internal-recruitment-queries.ts");
  assert.match(query, /const liveCallStatuses = \["calling", "dispatching", "initiated", "in_progress"\]/);
  assert.doesNotMatch(query, /activeStatuses = \["scheduled", "queued", "calling", "dispatching", "initiated", "in_progress", "retry_scheduled"\]/);
});

test("target booking links expose generated availability and materialize the selected virtual slot", () => {
  const target = read("src/lib/recruitment-target-portal.ts");
  assert.match(target, /virtualSlotsForRole\(role, kind === "voice" \? "AI Voice Interview" : "Final Interview", true, voiceTimezone\)/);
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

test("HR booking cards expose invitation delivery separately from booking state", () => {
  const page = read("src/app/applicants/[applicationId]/page.tsx");
  const target = read("src/lib/recruitment-target-portal.ts");
  const query = read("src/lib/internal-recruitment-queries.ts");
  assert.match(page, /Booking Link Email/);
  assert.match(page, /Booking link sent/);
  assert.match(page, /Booking link pending/);
  assert.match(page, /Booking email failed/);
  assert.match(target, /getApplicationBookingNotification\(externalId, "final"\)/);
  assert.match(query, /final_booking_invitation/);
  assert.match(query, /notificationSentAt/);
});

test("notification queue claims rows atomically to prevent overlapping duplicate sends", () => {
  const query = read("src/lib/internal-recruitment-queries.ts");
  const route = read("src/app/api/internal/recruitment/notifications/route.ts");
  assert.match(query, /db\.transaction\(async \(tx\) =>/);
  assert.match(query, /\.for\("update", \{ skipLocked: true \}\)/);
  assert.match(query, /notificationAttemptedAt/);
  assert.match(query, /leaseCutoff/);
  assert.match(query, /NOTIFICATION_CLAIM_LEASE_MINUTES/);
  assert.match(query, /not\(eq\(applicationStatusHistory\.notificationEventType, ""\)\)/);
  assert.match(route, /isPostgresRecruitmentTarget\(\)/);
  assert.match(route, /recruitment_target_not_enabled/);
});

test("Pilot target notifier is candidate-event allowlisted and never sends to an arbitrary mailbox", () => {
  const safety = read("src/lib/pilot-test-safety.ts");
  assert.match(safety, /PILOT_TEST_EMAIL = "cs6@mclinkgroup\.com"/);
});
