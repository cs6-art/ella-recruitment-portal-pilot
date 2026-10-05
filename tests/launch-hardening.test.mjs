import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("the tokenless avatar session and evaluate paths require a signed-in HR reviewer", () => {
  for (const file of ["src/app/api/live-avatar/session/route.ts", "src/app/api/live-avatar/evaluate/route.ts"]) {
    const source = read(file);
    assert.match(source, /canManagePipeline\(reviewer\)/, file);
    assert.match(source, /Authentication required\./, file);
  }
  const session = read("src/app/api/live-avatar/session/route.ts");
  assert.ok(session.indexOf("canManagePipeline(reviewer)") < session.indexOf("getRoleRequestById(roleId)"), "auth must run before any role lookup or provider call");
});

test("an avatar interview is refused, before the link is consumed, when the organization cannot cover it", () => {
  const session = read("src/app/api/live-avatar/session/route.ts");
  const guard = session.indexOf("balance < LIVE_AVATAR_MAX_CREDITS");
  assert.ok(guard > 0);
  assert.ok(guard < session.indexOf("await startAvatarInterview(avatarToken)"), "credit check must precede consuming the invitation");
  assert.match(session, /consumeDurableRateLimit\(`avatar-session:/);
});

test("public application, booking and avatar routes use the shared durable rate limit", () => {
  assert.match(read("src/app/api/public/applications/route.ts"), /await consumeDurableRateLimit\(/);
  assert.match(read("src/app/api/public/bookings/[kind]/[token]/route.ts"), /await consumeDurableRateLimit\(/);
  const limiter = read("src/lib/durable-rate-limit.ts");
  assert.match(limiter, /insert into rate_limit_buckets/);
  assert.match(limiter, /return consumeRateLimit\(key, limit, windowMs\)/, "must fail open to the per-instance limiter");
  assert.match(read("drizzle/0028_rate_limit_buckets.sql"), /CREATE TABLE IF NOT EXISTS "rate_limit_buckets"/);
});

test("calendar, Drive and OneDrive tokens are stored in Postgres when the portal runs on Postgres", () => {
  for (const [file, provider] of [["src/lib/calendar-tokens.ts", "google_calendar"], ["src/lib/drive-tokens.ts", "google_drive"], ["src/lib/microsoft-drive-tokens.ts", "microsoft_drive"]]) {
    const source = read(file);
    assert.ok(source.includes(`readOAuthConnection("${provider}"`), file);
    assert.match(source, /if \(!isPostgresRecruitmentTarget\(\)\) return \w+FromSheet\(/, file);
  }
  assert.match(read("drizzle/0029_oauth_connections_unique.sql"), /oauth_connections_org_provider_email_uidx/);
});

test("portal settings and the McLink staff directory read from Postgres, with the sheet only as a user fallback", () => {
  const sheets = read("src/lib/google-sheets.ts");
  assert.match(sheets, /readPortalSettingRows\(\)/);
  assert.match(sheets, /writePortalSettingRows\(/);
  assert.match(sheets, /findPostgresDirectoryUser\(email, DEFAULT_ORGANIZATION_ID\)/);
  assert.match(sheets, /Sheet fallback unavailable; using the database only/);
  const backfill = read("src/db/backfill-sheets-to-postgres.mjs");
  assert.match(backfill, /const commit = process\.argv\.includes\("--commit"\)/);
  assert.match(backfill, /on conflict do nothing/);
  assert.doesNotMatch(backfill, /\bdelete from\b/i);
});

test("health monitoring: liveness endpoint, authenticated daily digest, and CI", () => {
  assert.match(read("src/app/api/health/route.ts"), /select 1/);
  const cron = read("src/app/api/cron/health-alerts/route.ts");
  assert.match(cron, /suppliedSecret\(request\) !== expected/);
  assert.match(cron, /HEALTH_ALERT_EMAIL/);
  assert.match(read("vercel.json"), /\/api\/cron\/health-alerts/);
  const ci = read(".github/workflows/ci.yml");
  for (const step of ["npm run lint", "npx tsc --noEmit", "npm test"]) assert.ok(ci.includes(step), step);
});

test("sign-in and recovery routes use the shared durable rate limit and store only hashed keys", () => {
  for (const route of ["login", "register", "forgot", "reset", "resend", "verify"]) {
    assert.match(read(`src/app/api/auth/${route}/route.ts`), /await consumeDurableRateLimit\(/, route);
  }
  assert.match(read("src/lib/durable-rate-limit.ts"), /createHash\("sha256"\)\.update\(key\)/);
});

test("a new organization never inherits McLink's calendar address", () => {
  const sheets = read("src/lib/google-sheets.ts");
  assert.match(sheets, /inheritsMcLinkDefaults/);
  assert.match(sheets, /\(inheritsMcLinkDefaults \? "hrsg@mclinkgroup\.com" : ""\)/);
  assert.match(read("src/app/api/auth/google-calendar/connect/route.ts"), /!self && !calendarConfig\.email/);
});

test("an avatar interview reserves credits atomically and releases them on every failed start", () => {
  const session = read("src/app/api/live-avatar/session/route.ts");
  assert.match(session, /placeAvatarInterviewHold\(/);
  assert.equal((session.match(/await releaseHold\(\)/g) || []).length >= 4, true, "release on 410, recording failures and startup errors");
  const credits = read("src/lib/ella-credits.ts");
  assert.match(credits, /holdKey: avatarHoldKey\(input\.applicationId\)/);
  assert.match(credits, /status: "converted", reason: "billed"/);
});

test("consent is a visible required checkbox on both candidate apply forms, and the privacy notice is public", () => {
  assert.match(read("src/components/CandidateApplicationForm.tsx"), /needsConsentCheckbox && !consentGiven/);
  const page = read("public/index.html");
  assert.match(page, /id="consentCheckbox"/);
  assert.match(page, /consentBox && !consentBox\.checked/);
  assert.match(read("src/app/privacy/page.tsx"), /Privacy Notice for Applicants/);
});

test("interview recordings are deleted after the retention period without touching the transcript", () => {
  const store = read("src/lib/live-interview-store.ts");
  const purge = store.slice(store.indexOf("export async function purgeExpiredInterviewRecordings"));
  assert.match(purge, /deleteInterviewRecording\(row\.ref, row\.organizationId, row\.accountEmail\)/);
  assert.match(purge, /deleteRecordingDriveConnectionIfUnused\(row\.organizationId, row\.accountEmail\)/);
  assert.match(purge, /recordingStatus: "deleted"/);
  assert.doesNotMatch(purge, /clientTranscript|analysis:/);
  assert.match(read("src/app/api/cron/interview-retention/route.ts"), /suppliedSecret\(request\) !== expected/);
  assert.match(read("vercel.json"), /\/api\/cron\/interview-retention/);
});

test("production reports it if the legacy Sheets backend is ever active", () => {
  assert.match(read("src/lib/system-health.ts"), /legacy_backend/);
  assert.ok(fs.existsSync("docs/LEGACY-SHEETS-REMOVAL.md"));
});
