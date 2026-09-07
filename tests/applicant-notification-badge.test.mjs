import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("Applicants badge uses the data-driven new-applicant feed and hides at zero", () => {
  const shell = read("src/components/AppShell.tsx");
  const feed = read("src/components/NewApplicantsBell.tsx");
  assert.match(shell, /useNewApplicantFeed\(userEmail, showApplicants\)/);
  assert.match(shell, /applicantNotificationCount > 0/);
  assert.match(feed, /fetch\("\/api\/applicants\/recent"/);
});

test("Applicants badge preserves original capped display values", async () => {
  const { applicantNotificationBadge } = await import("../src/lib/new-applicants.ts");
  assert.equal(applicantNotificationBadge(0), "0");
  assert.equal(applicantNotificationBadge(1), "1");
  assert.equal(applicantNotificationBadge(9), "9");
  assert.equal(applicantNotificationBadge(10), "9+");
  assert.equal(applicantNotificationBadge(42), "9+");
});

test("Applicants badge keeps reviewer-only visibility and refresh behavior", () => {
  const shell = read("src/components/AppShell.tsx");
  const feed = read("src/components/NewApplicantsBell.tsx");
  assert.match(shell, /showApplicants = user\.canReviewRole === true \|\| user\.canApproveRole === true \|\| user\.canReviewDepartmentRole === true/);
  assert.match(feed, /setInterval\(\(\) =>/);
  assert.match(feed, /window\.addEventListener\("focus"/);
  assert.match(feed, /window\.addEventListener\("storage"/);
  assert.match(feed, /readApplicantsLastSeen\(userEmail\)/);
});

test("Applicants sidebar badge has the red numeric presentation", () => {
  const css = read("src/components/AppShell.module.css");
  assert.match(css, /\.navBadge[\s\S]*background: #d64545/);
  assert.match(css, /\.sidebarCollapsed \.navBadge/);
});

test("the notification bell reserves layout space instead of overlaying page controls", () => {
  const css = read("src/components/AppShell.module.css");
  const shell = read("src/components/AppShell.tsx");
  assert.match(css, /\.topBar[\s\S]*position: sticky/);
  assert.match(css, /\.topBar[\s\S]*min-height: 50px/);
  assert.doesNotMatch(css, /\.topBar\s*\{[^}]*position:\s*absolute/);
  assert.match(shell, /styles\.topBar[\s\S]*styles\.pageToolbar/);
});
