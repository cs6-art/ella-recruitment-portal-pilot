import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { calendarLookupStatus } from "../src/lib/calendar-lookup-status.ts";

test("an empty successfully checked calendar is ready", () => {
  assert.equal(calendarLookupStatus({ checked: true }), "ready");
});

test("only a confirmed missing connection prompts connection setup", () => {
  assert.equal(calendarLookupStatus({ checked: false, reason: "not_connected" }), "not_connected");
});

test("temporary availability failures do not become disconnections and can recover", () => {
  const results = [
    { checked: true },
    { checked: false, reason: "error" },
    { checked: true },
  ];
  assert.deepEqual(results.map(calendarLookupStatus), ["ready", "error", "ready"]);
  assert.equal(calendarLookupStatus({ checked: false }), "error");
});

test("bookings retain failure reasons and refresh calendar status independently of server props", () => {
  const api = fs.readFileSync("src/app/api/bookings/calendar-busy/route.ts", "utf8");
  const ui = fs.readFileSync("src/components/BookingsList.tsx", "utf8");
  assert.match(api, /calendarLookupStatus\(result\)/);
  assert.match(api, /calendarStatus:/);
  assert.match(api, /status === "error" \? null/);
  assert.match(ui, /setInterval\(refreshCalendar, 30_000\)/);
  assert.match(ui, /removeEventListener\("focus", refreshCalendar\)/);
  assert.match(ui, /calendarStatus\[role.roleId\] === lookupStatus/);
  assert.match(ui, /role\.roleId === calendarRole/);
  assert.doesNotMatch(ui, /Object.values\(calendarConnected\).some/);
});

test("HTTP-successful per-calendar Google errors are not reported as a free calendar", () => {
  const calendar = fs.readFileSync("src/lib/google-calendar.ts", "utf8");
  assert.match(calendar, /!calendarResult \|\| calendarResult.errors\?\.length/);
});
