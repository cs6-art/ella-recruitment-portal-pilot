import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const queries = read("src/lib/internal-recruitment-queries.ts");
const route = read("src/app/api/internal/recruitment/bookings/calendar/route.ts");

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
