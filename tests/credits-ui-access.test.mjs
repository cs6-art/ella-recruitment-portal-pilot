import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the dedicated Credits page reuses the narrow credit-management policy", () => {
  const page = read("src/app/credits/page.tsx");
  assert.match(page, /canManageCredits\(user\)/);
  assert.match(page, /redirect\("\/dashboard"\)/);
  assert.match(page, /EllaCreditsPanel/);
});

test("the sidebar exposes Credits only through canManageCredits", () => {
  const shell = read("src/components/AppShell.tsx");
  assert.match(shell, /import \{ canManageCredits \} from "@\/lib\/access-control"/);
  assert.match(shell, /const canManageEllaCredits = canManageCredits\(/);
  assert.match(shell, /canManageEllaCredits && <Link href="\/credits"/);
  assert.doesNotMatch(shell, /user\.canReviewRole === true && <Link href="\/credits"/);
});

test("the Credits page does not widen Settings access", () => {
  const settings = read("src/app/settings/page.tsx");
  const page = read("src/app/credits/page.tsx");
  assert.match(settings, /user\.canEditSettings !== true/);
  assert.match(page, /canManageCredits\(user\)/);
});
