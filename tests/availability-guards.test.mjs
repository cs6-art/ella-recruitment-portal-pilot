import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const rules = fs.readFileSync("src/lib/interview-availability-rules.ts", "utf8");
const availabilityRoute = fs.readFileSync("src/app/api/bookings/availability-rules/route.ts", "utf8");
const bookings = fs.readFileSync("src/components/BookingsList.tsx", "utf8");
const calendarBusyRoute = fs.readFileSync("src/app/api/bookings/calendar-busy/route.ts", "utf8");
const roleDetails = fs.readFileSync("src/components/RoleDetails.tsx", "utf8");
const roleForm = fs.readFileSync("src/components/RoleRequestForm.tsx", "utf8");
const workflow = fs.readFileSync("src/lib/applicant-workflow.ts", "utf8");

test("availability rules reject overlapping weekday windows and deduplicate legacy reads", () => {
  assert.match(rules, /"Completed", "No Show", "Cancelled"/);
  assert.match(rules, /export function availabilityRulesOverlap/);
  assert.match(rules, /left\.weekdays\.some/);
  assert.match(rules, /export function withoutOverlappingAvailabilityRules/);
  assert.match(rules, /const rules = withoutOverlappingAvailabilityRules\(stored\)/);
  assert.match(rules, /new Map\(slots\.map/);
  assert.match(rules, /date <= text\(targetHiringDate\)/);
  assert.match(rules, /startTime: "10:00"/);
  assert.match(rules, /endTime: "16:00"/);
  assert.match(rules, /start === 12 \* 60/);
  assert.match(rules, /isVoiceInterview \|\| isFinalInterview \? \[1, 2, 3, 4, 5\]/);
  assert.match(rules, /export function isTargetHiringDateOverdue/);
  assert.match(bookings, /Target hiring date overdue/);
  assert.match(bookings, /is-target-overdue/);
  assert.match(workflow, /date: normalizeDateOnly\(field\(row, "Date"\)\)/);
  assert.match(workflow, /startTime: normalizeTimeOnly\(field\(row, "Start_Time", "Start Time"\)\)/);
});

test("availability write API blocks stacked voice schedules and rejects manual final schedules", () => {
  assert.match(availabilityRoute, /availabilityRulesOverlap/);
  assert.match(availabilityRoute, /overlaps an existing active schedule/);
  assert.match(availabilityRoute, /HR interview availability is managed automatically through the connected HR Google Calendar/);
  assert.doesNotMatch(availabilityRoute, /slotMatchesHodAvailability/);
});

test("final interview setup no longer asks for manual dates or availability windows", () => {
  assert.doesNotMatch(roleDetails, /HodAvailabilityEditor/);
  assert.doesNotMatch(roleDetails, /Availability Windows/);
  assert.match(roleDetails, /Managed through the shared HR Google Calendar configured in Settings/);
  assert.doesNotMatch(roleForm, /addAvailability|removeAvailability|updateAvailability/);
  assert.doesNotMatch(bookings, /<option>Final Interview<\/option>/);
  assert.match(bookings, /Face-to-Face interview availability/);
  assert.doesNotMatch(bookings, /<strong>AI Voice Interview<\/strong>/);
  assert.match(workflow, /let slots = kind === "final" \? \[\]/);
  assert.match(workflow, /Connect the HR Google Calendar before booking an HR interview/);
  assert.match(calendarBusyRoute, /calendarConnected/);
  assert.match(bookings, /finalCalendarConnected !== true/);
});

test("calendar counter uses configured windows and recruitment setup is editable from role details", () => {
  assert.match(bookings, /function activeWindowCount/);
  assert.match(bookings, /\{activeWindows\}/);
  assert.match(bookings, /Configured recurring and specific windows/);
  assert.match(roleDetails, /RecruitmentSetupEditor[^\n]*editable=\{canReviewRole\}/);
});
