import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("workflow pages refresh visible database data without wasteful polling", () => {
  const refresh = read("src/components/ApplicantLiveRefresh.tsx");
  const list = read("src/components/ApplicantsList.tsx");
  const bookings = read("src/components/BookingsList.tsx");
  const page = read("src/app/applicants/[applicationId]/page.tsx");
  assert.match(refresh, /REFRESH_MS = 5 \* 60_000/);
  assert.match(refresh, /EVENT_REFRESH_THROTTLE_MS = 30_000/);
  assert.match(refresh, /if \(!enabled\) return/);
  assert.match(refresh, /document\.visibilityState !== "visible"/);
  assert.match(refresh, /lastRefreshAt/);
  assert.match(list, /Refresh applicants/);
  assert.doesNotMatch(list, /ApplicantLiveRefresh enabled intervalMs=\{30_000\}/);
  assert.match(list, /if \(page !== 1\) return/);
  assert.match(bookings, /LiveDataRefresh enabled intervalMs=\{30_000\} throttleMs=\{30_000\}/);
  assert.match(bookings, /APPOINTMENT_STATUS_FILTERS/);
  assert.doesNotMatch(bookings, /APPOINTMENT_RECORD_LIMIT/);
  assert.match(bookings, /Showing all \{appointmentRecords\.length\} persisted records/);
  assert.match(page, /TERMINAL_APPLICANT_STAGES/);
  assert.match(page, /enabled=\{!TERMINAL_APPLICANT_STAGES\.has/);
});

test("target applicant detail does not reload the full applicant list", () => {
  const target = read("src/lib/recruitment-target-portal.ts");
  const detail = target.slice(target.indexOf("export async function targetApplicantDetails"));
  assert.doesNotMatch(detail, /targetApplicantSummaries\(\)/);
  assert.match(target, /RESUME_TEXT_CACHE_MAX_ENTRIES = 32/);
  assert.match(target, /resumeTextInFlight/);
});

test("applicant list and metrics share target Postgres query work per render", () => {
  const source = read("src/lib/candidate-applications.ts");
  const target = read("src/lib/recruitment-target-portal.ts");
  assert.match(source, /cache\(targetApplicantSummaries\)/);
  assert.match(source, /targetApplicantMetrics\(filters\)/);
  assert.match(source, /targetApplicantPage\(input\)/);
  assert.match(target, /listApplications\(undefined, undefined, organizationId, \{[\s\S]*?limit: pageSize,[\s\S]*?offset: \(page - 1\) \* pageSize/);
  assert.match(target, /countApplications\(organizationId, filters\)/);
});

test("public role pages use short revalidation while booking remains live", () => {
  assert.match(read("src/app/apply/page.tsx"), /revalidate = 60/);
  assert.match(read("src/app/apply/[roleId]/page.tsx"), /force-dynamic/);
  assert.match(read("src/app/book/[kind]/[token]/page.tsx"), /force-dynamic/);
});
