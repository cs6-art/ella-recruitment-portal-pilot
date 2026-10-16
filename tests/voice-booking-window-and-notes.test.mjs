import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { VOICE_BOOKING_WINDOW_HOURS, isWithinVoiceBookingWindow, voiceBookingExpiresAt } from "../src/lib/voice-booking-window.ts";
import { NOTE_MAX_LENGTH, canChangeNote, cleanNoteBody } from "../src/lib/applicant-notes-shared.ts";

const sent = new Date("2026-10-20T07:00:00Z"); // 15:00 Singapore
const slot = (date, startTime) => ({ date, startTime, timezone: "Asia/Singapore" });

test("voice booking window is exactly 48 hours from the send time", () => {
  assert.equal(VOICE_BOOKING_WINDOW_HOURS, 48);
  assert.equal(voiceBookingExpiresAt(sent).toISOString(), "2026-10-22T07:00:00.000Z");
  assert.equal(isWithinVoiceBookingWindow(slot("2026-10-22", "14:59"), sent), true);
  assert.equal(isWithinVoiceBookingWindow(slot("2026-10-22", "15:00"), sent), true, "exactly 48h is still inside");
  assert.equal(isWithinVoiceBookingWindow(slot("2026-10-22", "15:01"), sent), false);
  assert.equal(isWithinVoiceBookingWindow(slot("2026-10-25", "10:00"), sent), false);
  assert.equal(isWithinVoiceBookingWindow(slot("2026-10-20", "16:00"), sent), true);
});

test("a missing send time does not hide times", () => {
  assert.equal(isWithinVoiceBookingWindow(slot("2026-12-01", "10:00"), null), true);
});

test("voice tokens always expire after 48 hours, final links keep their own expiry", () => {
  const queries = fs.readFileSync(new URL("../src/lib/internal-recruitment-queries.ts", import.meta.url), "utf8");
  assert.match(queries, /input\.kind === "voice" \? voiceBookingExpiresAt\(\)/);
  const portal = fs.readFileSync(new URL("../src/lib/recruitment-target-portal.ts", import.meta.url), "utf8");
  assert.match(portal, /kind !== "voice" \|\| isWithinVoiceBookingWindow\(slot, token\.token\.createdAt\)/);
});

test("note bodies are trimmed, non-empty and capped", () => {
  assert.deepEqual(cleanNoteBody("  hello  "), { ok: true, body: "hello" });
  assert.equal(cleanNoteBody("   ").ok, false);
  assert.equal(cleanNoteBody(undefined).ok, false);
  assert.equal(cleanNoteBody("x".repeat(NOTE_MAX_LENGTH + 1)).ok, false);
  assert.equal(cleanNoteBody("x".repeat(NOTE_MAX_LENGTH)).ok, true);
});

test("only the author or an administrator can change a note", () => {
  const note = { authorEmail: "a@x.com" };
  assert.equal(canChangeNote({ email: "A@x.com", accessAdmin: false }, note), true);
  assert.equal(canChangeNote({ email: "b@x.com", accessAdmin: false }, note), false);
  assert.equal(canChangeNote({ email: "b@x.com", accessAdmin: true }, note), true);
  assert.equal(canChangeNote({ email: "", accessAdmin: false }, { authorEmail: "" }), false);
});

test("notes routes are HR-gated, org-scoped and never in public booking code", () => {
  const route = fs.readFileSync(new URL("../src/app/api/applicants/[applicationId]/notes/route.ts", import.meta.url), "utf8");
  assert.match(route, /canDecideApplicant/);
  assert.match(route, /user\.organizationId/);
  const lib = fs.readFileSync(new URL("../src/lib/applicant-notes.ts", import.meta.url), "utf8");
  assert.match(lib, /eq\(applications\.organizationId, organizationId\)/);
  assert.match(lib, /isNull\(applicationNotes\.deletedAt\)/);
  for (const file of ["../src/app/api/public/bookings/[kind]/[token]/route.ts", "../src/components/BookingSelector.tsx"]) {
    assert.doesNotMatch(fs.readFileSync(new URL(file, import.meta.url), "utf8"), /applicationNotes|applicant-notes/);
  }
});
