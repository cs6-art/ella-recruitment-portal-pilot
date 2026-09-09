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
  assert.match(query, /return rows\.map\(\(\{ history, \.\.\.context \}\) => \(\{ \.\.\.history, \.\.\.context \}\)\)/);
  assert.match(route, /searchParams\.get\("stage"\)/);
});

test("target booking tokens create a notification event once", () => {
  const query = read("src/lib/internal-recruitment-queries.ts");
  const route = read("src/app/api/internal/recruitment/bookings/tokens/route.ts");
  assert.match(query, /booking-invitation:\$\{input\.kind\}:\$\{input\.applicationExternalId\}/);
  assert.match(query, /notificationStatus: "pending"/);
  assert.match(route, /notificationHistoryId: result\.notificationHistoryId/);
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
