import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("Pilot outbound email uses the applicant and explicit monitoring copies", () => {
  const safety = read("src/lib/pilot-test-safety.ts");
  const invite = read("src/lib/application-invite-email.ts");
  assert.match(safety, /PILOT_TEST_EMAIL = "cs6@mclinkgroup\.com"/);
  assert.match(safety, /PILOT_INTERNAL_EMAIL_COPIES = \["cs6@mclinkgroup\.com", "cs9@mclinkgroup\.com", "hrsg@mclinkgroup\.com"\]/);
  assert.match(safety, /return false/);
  assert.match(safety, /const cc = PILOT_INTERNAL_EMAIL_COPIES\.filter/);
  assert.match(safety, /intendedTo/);
  assert.match(invite, /pilotEmailRecipient\(input\.candidateEmail\)/);
  assert.match(invite, /delivery: \{ to: recipient\.to, cc: recipient\.cc/);
  assert.doesNotMatch(invite, /testMailbox/);
});

test("Pilot voice dispatch delegates provider ownership to n8n", () => {
  const route = read("src/app/api/internal/recruitment/voice/dispatch/route.ts");
  assert.match(route, /beginVoiceAttemptDispatch/);
  assert.match(route, /dispatchReady: true/);
  assert.match(route, /candidate:/);
  assert.match(route, /phoneNumber/);
  assert.doesNotMatch(route, /api\.vapi\.ai\/call/);
  assert.doesNotMatch(route, /PILOT_VAPI_API_KEY/);
});

test("target voice booking creates a durable attempt only once", () => {
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(queries, /slot\.interviewType === "voice"/);
  assert.match(queries, /voiceCallAttempts\.applicationId/);
  assert.match(queries, /\["scheduled", "queued", "calling", "initiated", "in_progress"\]/);
  assert.match(queries, /status = 'dispatching'/);
  assert.match(queries, /attemptNumber: 1, maxAttempts: 3/);
  assert.match(queries, /scheduleVoiceRetry/);
  assert.match(queries, /nextAttemptNumber = current\.attemptNumber \+ 1/);
});

test("voice retry endpoint is authenticated and idempotent", () => {
  const route = read("src/app/api/internal/recruitment/voice/attempts/retry/route.ts");
  assert.match(route, /withInternalAuth\("voice_attempts"/);
  assert.match(route, /attemptId_and_retryAfter_required/);
  assert.match(route, /duplicate: result\.duplicate/);
});

test("target notification queue preserves history IDs and enriches safe delivery context", () => {
  const query = read("src/lib/internal-recruitment-queries.ts");
  const route = read("src/app/api/internal/recruitment/notifications/route.ts");
  assert.match(query, /applicationExternalId: applications\.externalId/);
  assert.match(query, /rows\.map\(\(\{ history, \.\.\.context \}\) => \(\{\s*\.\.\.history,\s*\.\.\.context,/);
  assert.match(query, /eventLabel: notificationEventLabel\(history\.notificationEventType\)/);
  assert.match(query, /summary: notificationSummary\(history\.notificationEventType, history\.comments\)/);
  assert.match(route, /searchParams\.get\("stage"\)/);
});

test("target booking tokens create a notification event once", () => {
  const query = read("src/lib/internal-recruitment-queries.ts");
  const route = read("src/app/api/internal/recruitment/bookings/tokens/route.ts");
  assert.match(query, /booking-invitation:\$\{input\.kind\}:\$\{input\.applicationExternalId\}/);
  assert.match(query, /notificationStatus: "pending"/);
  assert.match(route, /notificationHistoryId: result\.notificationHistoryId/);
});

// Pins the exact wire contract n8n's "Create final booking token" node depends on
// (workflow ExccjPAxp1Zr7EkN). That node once built its body from a field path that
// doesn't exist on the queue response (item.json.externalId instead of
// item.json.application.externalId), silently dropping applicationExternalId and
// always failing with application_kind_required. If either field name below moves,
// n8n's expression must move with it.
test("booking token creation requires applicationExternalId and kind by exact name", () => {
  const route = read("src/app/api/internal/recruitment/bookings/tokens/route.ts");
  assert.match(route, /requiredString\(item\.applicationExternalId\) && requiredString\(item\.kind\)/);
  assert.match(route, /error: "application_kind_required" \}, 422\)/);
  assert.match(route, /body\.kind !== "voice" && body\.kind !== "final"/);
  assert.match(route, /error: "invalid_booking_kind" \}, 422\)/);
});

// Pins the applications-queue response shape n8n's "Split voice HR decision items"
// node splits and reads from: each item nests the application row under an
// `application` key, so its externalId lives at item.json.application.externalId —
// NOT item.json.externalId.
test("applications queue nests each row's externalId under application.externalId", () => {
  const query = read("src/lib/internal-recruitment-queries.ts");
  assert.match(query, /export async function listApplications/);
  const start = query.indexOf("export async function listApplications");
  const body = query.slice(start, query.indexOf("\n}", start));
  assert.match(body, /application: applications/);
  assert.doesNotMatch(body, /externalId: applications\.externalId/);
});

test("target role and applicant paths resolve Postgres before legacy Sheets", () => {
  const roles = read("src/app/api/roles/route.ts");
  const detail = read("src/app/api/roles/[roleId]/route.ts");
  const setup = read("src/app/api/roles/[roleId]/recruitment-setup/route.ts");
  const applicants = read("src/app/api/applicants/route.ts");
  assert.match(roles, /isPostgresRecruitmentTarget\(\) \? await targetRoleSummaries\(\)/);
  assert.match(roles, /generateRoleId\(input\.jobTitle, \(await listRoles\(\)\)/);
  assert.match(detail, /isPostgresRecruitmentTarget\(\)\s*\? await targetRoleDetails/);
  assert.match(setup, /isPostgresRecruitmentTarget\(\) \? await targetRoleDetails/);
  assert.match(applicants, /isPostgresRecruitmentTarget\(\) \? await targetRoleDetails/);
});
