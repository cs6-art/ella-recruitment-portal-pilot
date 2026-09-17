import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the dedicated Credits page is available to authenticated users", () => {
  const page = read("src/app/credits/page.tsx");
  assert.match(page, /canManageCredits\(user\)/);
  assert.match(page, /EllaCreditsPanel/);
  assert.match(page, /EllaCreditsPurchase/);
  assert.match(page, /canManage &&/);
});

test("the sidebar exposes Credits to authenticated users for purchases", () => {
  const shell = read("src/components/AppShell.tsx");
  assert.match(shell, /<Link href="\/credits"/);
});

test("the Credits page does not widen Settings access", () => {
  const settings = read("src/app/settings/page.tsx");
  const page = read("src/app/credits/page.tsx");
  assert.match(settings, /user\.canEditSettings !== true/);
  assert.match(page, /canManageCredits\(user\)/);
});

test("the purchase UI is separate from manual credit management", () => {
  const purchase = read("src/components/EllaCreditsPurchase.tsx");
  const panel = read("src/components/EllaCreditsPanel.tsx");
  assert.match(purchase, /\/api\/ella-credits\/payments/);
  assert.match(purchase, /Pay with HitPay/);
  assert.match(panel, /\/api\/ella-credits/);
  assert.match(read("src/app/credits/page.tsx"), /canManage && <EllaCreditsPanel \/>/);
});

test("the payment return screen reconciles missed webhooks and offers recovery", () => {
  const purchase = read("src/components/EllaCreditsPurchase.tsx");
  assert.match(purchase, /method: "POST"/);
  assert.match(purchase, /reconcilePaymentStatus/);
  assert.match(purchase, /Check payment again/);
  assert.match(purchase, /creditedAt/);
  assert.match(purchase, /attempt === 0 \|\| attempt % 5 === 0/);
});

test("credit activity is paginated in the UI", () => {
  const panel = read("src/components/EllaCreditsPanel.tsx");
  assert.match(panel, /ACTIVITY_PAGE_SIZE = 10/);
  assert.match(panel, /visibleEntries = filteredEntries\.slice\(activityStart/);
  assert.match(panel, /Credit activity pagination/);
  assert.match(panel, /Showing \{activityStart \+ 1\}/);
});

test("credit activity is recent-first, filterable, and keeps a stable table footprint", () => {
  const panel = read("src/components/EllaCreditsPanel.tsx");
  const route = read("src/app/api/ella-credits/route.ts");
  const styles = read("src/components/EllaCreditsPanel.module.css");
  assert.match(route, /newest-first/);
  assert.match(route, /sort\(\(left, right\)/);
  assert.match(panel, /Search credit activity/);
  assert.match(panel, /Filter credit activity type/);
  assert.match(panel, /Filter credit activity event/);
  assert.match(panel, /No activity matches the current filters/);
  assert.match(panel, /placeholder-\$\{index\}/);
  assert.match(panel, /Voice interview/);
  assert.match(panel, /Each signed-in user has a separate Smile Credits balance inside their organization/);
  assert.match(styles, /min-height: 540px/);
  assert.match(styles, /table-layout: fixed/);
});
