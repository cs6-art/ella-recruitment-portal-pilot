import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const poll = read("src/lib/client-poll.ts");
const meter = read("src/components/EllaCreditsMeter.tsx");
const bell = read("src/components/NewApplicantsBell.tsx");
const appShell = read("src/components/AppShell.tsx");
const bulk = read("src/components/BulkResumeScreeningPanel.tsx");

test("the shared poller dedupes in-flight requests and is visibility-aware", () => {
  assert.match(poll, /export function useSharedPoll/);
  assert.match(poll, /if \(inFlight\) return inFlight/);              // one request at a time
  assert.match(poll, /document\.visibilityState === "visible"/);      // interval only while visible
  assert.match(poll, /if \(listeners\.size === 0\) stopTimers\(\)/);  // stop when nobody is mounted
  assert.match(poll, /Date\.now\(\) - lastFetch < throttleMs/);       // throttled focus refresh
});

test("EllaCreditsMeter shares one poll, backs off to five minutes, and keeps event-driven refresh", () => {
  assert.match(meter, /useSharedPoll<MeterData>\(POLL_KEY, fetchMeterData, POLL_INTERVAL_MS\)/);
  assert.match(meter, /POLL_KEY = "ella-credits-balance"/);
  assert.match(meter, /POLL_INTERVAL_MS = 5 \* 60_000/);
  // no component-local polling interval any more
  assert.doesNotMatch(meter, /setInterval/);
  // a credit-changing action still updates the meter immediately + reconciles
  assert.match(meter, /ELLA_CREDITS_REFRESH_EVENT/);
  assert.match(meter, /RECONCILE_DELAYS_MS/);
  assert.match(meter, /setOptimistic\(\(current\) => current \+ delta\)/);
});

test("the recent-applicants feed is a single shared poll for both callers", () => {
  assert.match(bell, /useSharedPoll<RecentApplicant\[\]>\(POLL_KEY, fetchRecentApplicants, POLL_INTERVAL_MS, enabled\)/);
  assert.match(bell, /POLL_KEY = "applicants-recent"/);
  assert.match(bell, /POLL_INTERVAL_MS = 5 \* 60_000/);
  assert.doesNotMatch(bell, /setInterval/);
  // exactly one place fetches the endpoint, and AppShell reuses the same hook
  const hits = (s) => (s.match(/fetch\("\/api\/applicants\/recent"/g) || []).length;
  assert.equal(hits(bell), 1);
  assert.equal(hits(appShell), 0);
  assert.match(appShell, /useNewApplicantFeed\(userEmail, showApplicants\)/);
});

test("bulk screening polls only while a batch is pending and the tab is visible", () => {
  assert.match(bulk, /if \(!roleId \|\| !anyPending\) return;/);        // no poll when nothing is processing
  assert.match(bulk, /TERMINAL_STATUSES/);                              // stops on terminal state
  assert.match(bulk, /document\.visibilityState === "visible"\) void refreshStatus\(\)/); // hidden = no poll
  assert.match(bulk, /addEventListener\("visibilitychange", onVisible\)/); // catch up on return
});
