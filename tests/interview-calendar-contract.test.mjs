import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const queries = read("src/lib/internal-recruitment-queries.ts");
const route = read("src/app/api/internal/recruitment/bookings/calendar/route.ts");
const targetPortal = read("src/lib/recruitment-target-portal.ts");
const slotsRoute = read("src/app/api/bookings/slots/route.ts");

test("the calendar write-back route is authenticated, Sheets-free, and dual (GET queue + POST)", () => {
  assert.match(route, /withInternalAuth\("booking"/);
  assert.doesNotMatch(route, /google-sheets|googleapis|spreadsheets\.values|Sheets/);
  assert.match(route, /export const GET = withInternalAuth/);
  assert.match(route, /export const POST = withInternalAuth/);
  assert.match(route, /calendarEventQueue/);
  assert.match(route, /markInterviewCalendarEvent/);
});

test("only booked face-to-face slots with no event id are surfaced for calendar creation", () => {
  assert.match(queries, /export async function calendarEventQueue\(\)/);
  assert.match(queries, /eq\(interviewSlots\.status, "booked"\)/);
  assert.match(queries, /eq\(interviewSlots\.interviewType, "final"\)/);
  assert.match(queries, /eq\(interviewSlots\.calendarEventId, ""\)/);
  assert.match(queries, /not\(eq\(interviewSlots\.calendarEventStatus, "skipped"\)\)/);
});

test("a replayed calendar callback never records a second event id", () => {
  assert.match(queries, /export async function markInterviewCalendarEvent/);
  // different incoming id while one is already stored -> rejected as duplicate
  assert.match(queries, /slot\.calendarEventId && incomingId && slot\.calendarEventId !== incomingId/);
  assert.match(queries, /calendar_event_already_recorded/);
  // same / missing id -> idempotent no-op
  assert.match(queries, /duplicate: true, error: null, eventId: slot\.calendarEventId/);
});

test("a failed calendar attempt is recorded and left retryable, not silently dropped", () => {
  assert.match(queries, /calendarEventStatus: "failed", calendarEventError:/);
  // failure path does not write calendarEventId, so the slot stays in calendarEventQueue()
  assert.match(queries, /if \(input\.status === "failed"\)/);
});

test("the slot is resolvable by id, code, or application + interview type", () => {
  assert.match(queries, /if \(input\.slotId\)/);
  assert.match(queries, /else if \(input\.slotCode\)/);
  assert.match(queries, /else if \(input\.applicationExternalId && input\.interviewType\)/);
});

test("Postgres HR slots are manually creatable and final booking creates and records Calendar events", () => {
  assert.doesNotMatch(slotsRoute, /HR interview availability is managed automatically/);
  assert.match(targetPortal, /createFinalInterviewEvent/);
  assert.match(targetPortal, /markInterviewCalendarEvent/);
  assert.match(targetPortal, /kind !== "final"/);
  assert.match(targetPortal, /calendar\.created \? "created" : "failed"/);
  assert.match(targetPortal, /attendeeEmails: \[context\.email\]/);
});

test("Pilot applicant booking hides calendar-busy final slots and rechecks persisted slots", () => {
  assert.match(targetPortal, /getCalendarBusyWindows/);
  assert.match(targetPortal, /if \(kind === "final" && available\.length > 0\)/);
  assert.match(targetPortal, /available = busyResult\.checked/);
  assert.match(targetPortal, /if \(kind === "final" && persistedSlot\)/);
  assert.match(targetPortal, /calendar_conflict/);
});

test("Pilot applicant details pass booked final slot timezone and calendar metadata to the profile card", () => {
  assert.match(targetPortal, /const finalEndsAt = finalSlot/);
  assert.match(targetPortal, /finalInterviewSlot: finalSlot \?/);
  assert.match(targetPortal, /timezone: finalSlotTimezone/);
  assert.match(targetPortal, /google_calendar_event_status/);
});
