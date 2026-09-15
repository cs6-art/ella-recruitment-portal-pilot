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

test("credit activity is paginated in the UI", () => {
  const panel = read("src/components/EllaCreditsPanel.tsx");
  assert.match(panel, /ACTIVITY_PAGE_SIZE = 10/);
  assert.match(panel, /visibleEntries = data\?\.entries\.slice\(activityStart/);
  assert.match(panel, /Credit activity pagination/);
  assert.match(panel, /Showing \{activityStart \+ 1\}/);
});
