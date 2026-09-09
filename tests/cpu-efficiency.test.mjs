import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("applicant live refresh is visible-only, throttled, slower, and terminal-aware", () => {
  const refresh = read("src/components/ApplicantLiveRefresh.tsx");
  const page = read("src/app/applicants/[applicationId]/page.tsx");
  assert.match(refresh, /REFRESH_MS = 5 \* 60_000/);
  assert.match(refresh, /EVENT_REFRESH_THROTTLE_MS = 30_000/);
  assert.match(refresh, /if \(!enabled\) return/);
  assert.match(refresh, /document\.visibilityState !== "visible"/);
  assert.match(refresh, /lastRefreshAt/);
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
  assert.match(source, /cache\(targetApplicantSummaries\)/);
  assert.match(source, /targetApplicantMetrics\(await cachedTargetApplicantSummaries\(\)\)/);
});

test("public role pages use short revalidation while booking remains live", () => {
  assert.match(read("src/app/apply/page.tsx"), /revalidate = 60/);
  assert.match(read("src/app/apply/[roleId]/page.tsx"), /force-dynamic/);
  assert.match(read("src/app/book/[kind]/[token]/page.tsx"), /force-dynamic/);
});
