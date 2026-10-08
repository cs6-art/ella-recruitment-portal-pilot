import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const calendar = fs.readFileSync("src/lib/google-calendar.ts", "utf8");
const callback = fs.readFileSync("src/app/api/auth/google-calendar/callback/route.ts", "utf8");
const status = fs.readFileSync("src/app/api/auth/google-calendar/status/route.ts", "utf8");
const connect = fs.readFileSync("src/components/GoogleCalendarConnect.tsx", "utf8");
const sheets = fs.readFileSync("src/lib/google-sheets.ts", "utf8");
const settings = fs.readFileSync("src/app/api/settings/route.ts", "utf8");
const calendarBusy = fs.readFileSync("src/app/api/bookings/calendar-busy/route.ts", "utf8");

test("Google Calendar OAuth verifies the authorized account before storing tokens", () => {
  assert.match(calendar, /userinfo\.email/);
  assert.match(calendar, /getTokenInfo\(tokens\.access_token\)/);
  assert.match(calendar, /CalendarAccountMismatchError/);
  assert.match(calendar, /authorizedEmail !== expectedEmail/);
  assert.match(calendar, /getAuthorizedClientWithIdentity/);
  assert.match(calendar, /accountEmail !== normalizedEmail\(email\)/);
  // identity comes from userinfo.email only; event contents are never read
  assert.doesNotMatch(calendar, /events\.list/);
  assert.match(calendar, /CalendarScopeError/);
  assert.match(callback, /calendar_account_mismatch/);
});

test("Calendar status exposes the verified connected account", () => {
  assert.match(status, /getCalendarConnectionStatus/);
  assert.match(status, /accountEmail/);
  assert.match(connect, /Connected account:/);
  assert.match(connect, /canManage/);
  assert.doesNotMatch(connect, /Expected Google account/);
  assert.match(status, /accountMismatch/);
  assert.doesNotMatch(status, /Settings permission required/);
});

test("final interviews use the shared calendar configured in Settings", () => {
  assert.match(sheets, /Final_Interview_Calendar_Email/);
  assert.match(sheets, /Final_Interview_Calendar_ID/);
  assert.match(sheets, /getFinalInterviewCalendarConfig/);
  assert.match(calendar, /finalInterviewCalendarTarget/);
  assert.match(calendar, /calendarId: target\.calendarId/);
  assert.match(calendarBusy, /getCalendarBusyWindows/);
  assert.match(settings, /Final_Interview_Calendar_Email/);
});
