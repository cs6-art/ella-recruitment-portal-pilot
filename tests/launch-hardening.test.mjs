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
  const guard = session.indexOf("balance < CREDIT_COST.live_avatar_interview");
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
