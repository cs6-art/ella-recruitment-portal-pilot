import { createHmac } from "node:crypto";
import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { MANUAL_TUTORIALS } from "../../src/lib/manual-tutorials.ts";

const widths = [1440, 1024, 768, 390];

function localSecret() {
  const line = fs.readFileSync(".env.local", "utf8").split(/\r?\n/).find((value) => value.startsWith("SESSION_SECRET="));
  return line?.slice("SESSION_SECRET=".length).trim() || "";
}

function tokenFor(user) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const signature = createHmac("sha256", localSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

const creator = {
  sub: "browser-creator",
  name: "Browser Creator",
  email: "creator@mclinkgroup.com",
  active: true,
  organizationId: "00000000-0000-4000-8000-000000000001",
  accessRole: "Creator",
  department: "AI",
  canCreateRole: true,
  canReviewRole: false,
  canApproveRole: false,
  canEditSettings: false,
};

const settingsAdmin = {
  ...creator,
  sub: "browser-settings-admin",
  name: "Settings Administrator",
  email: "settings-admin@mclinkgroup.com",
  accessRole: "HR",
  canReviewRole: true,
  canEditSettings: true,
  platformAdmin: true,
};

async function signIn(page, user) {
  await page.context().addCookies([{ name: "mclink_session", value: tokenFor(user), url: "http://127.0.0.1:3000" }]);
}

async function expectNoHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("login page renders at all target widths", async ({ page }) => {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test("creator dashboard and role creation remain responsive", async ({ page }) => {
  await signIn(page, creator);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Welcome back/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create Role Request", exact: true }).first()).toBeVisible();
    await expect(page.locator(".dashboard-stat-card")).toHaveCount(4);
    await expectNoHorizontalOverflow(page);
  }
  await page.goto("/roles/new");
  await expect(page.getByRole("heading", { name: /Create role request/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.goto("/settings");
  await expect(page).toHaveURL(/127\.0\.0\.1:3000\/dashboard/);
  await expectNoHorizontalOverflow(page);
});

test("unauthenticated protected pages redirect safely", async ({ page }) => {
  for (const path of ["/dashboard", "/roles", "/roles/new", "/settings", "/profile"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/127\.0\.0\.1:3000\/$/);
  }
});

test("settings access and logout work for settings administrator", async ({ page }) => {
  await signIn(page, settingsAdmin);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Credits" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: /Sign out/i }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
});

test("manual topics open their matching walkthroughs and stay usable on desktop and mobile", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, creator);
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/manual", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Explore Manual" })).toBeVisible();
    const search = page.getByRole("searchbox", { name: "Search the manual" });
    await search.fill("manual-hydration-check-no-match");
    await expect(page.getByText("No topics match your search.")).toBeVisible();
    await search.fill("");
    const mobileTopics = page.locator('nav[aria-label="Manual topics"] details');
    if (width <= 860) await mobileTopics.locator("summary").click();
    await expect(page.locator('nav[aria-label="Manual topics"] a:visible span[title="Video walkthrough available"]')).toHaveCount(17);
    await expect(page.locator("iframe")).toHaveCount(0);

    for (const [sectionId, youtubeId] of Object.entries(MANUAL_TUTORIALS)) {
      if (width <= 860 && !(await mobileTopics.evaluate((element) => element.open))) {
        await mobileTopics.locator("summary").click();
      }
      const topic = page.locator(`nav[aria-label="Manual topics"] a[href="#${sectionId}"]:visible`);
      await topic.click();
      await expect(page.locator(`nav[aria-label="Manual topics"] a[href="#${sectionId}"][aria-current="location"]`)).toHaveCount(2);
      await expect(page.locator(`#${sectionId}-heading`)).toBeVisible();
      const tutorial = page.locator(`#manual-tutorial-${sectionId}`);
      await expect(tutorial).toBeVisible();
      await expect(tutorial.locator("img")).toHaveAttribute("src", `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`);
      await expect(page.locator("iframe")).toHaveCount(0, { timeout: 1000 });
      await expectNoHorizontalOverflow(page);
    }

    if (width <= 860 && !(await mobileTopics.evaluate((element) => element.open))) {
      await mobileTopics.locator("summary").click();
    }
    const firstTopic = page.locator('nav[aria-label="Manual topics"] a[href="#a-quick-start"]:visible');
    await firstTopic.click();
    const firstTutorial = page.locator("#manual-tutorial-a-quick-start");
    const tutorialNavigation = firstTutorial.locator('nav[aria-label="Tutorial navigation"]');
    await expect(tutorialNavigation.getByRole("button", { name: /Previous tutorial/ })).toBeDisabled();
    await tutorialNavigation.getByRole("button", { name: /Next tutorial/ }).click();
    await expect(page.locator('nav[aria-label="Manual topics"] a[href="#b-user-types"][aria-current="location"]')).toHaveCount(2);
    if (width <= 860 && !(await mobileTopics.evaluate((element) => element.open))) {
      await mobileTopics.locator("summary").click();
    }
    await page.locator('nav[aria-label="Manual topics"] a[href="#a-quick-start"]:visible').click();

    await page.locator("#manual-tutorial-a-quick-start").getByRole("button", { name: /Play A\. Quick start video walkthrough/ }).click();
    const activePlayer = page.locator("iframe");
    await expect(activePlayer).toHaveCount(1);
    await expect(activePlayer).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/b6aZWtOx1Mc?rel=0&autoplay=1");
    await page.locator("#manual-tutorial-a-quick-start").locator('nav[aria-label="Tutorial navigation"]').getByRole("button", { name: /Next tutorial/ }).click();
    await expect(page.locator("iframe")).toHaveCount(0);

    await search.fill("Status reference");
    const statusTopic = page.locator('nav[aria-label="Manual topics"] a[href="#o-status-reference"]:visible');
    if (width <= 860 && !(await mobileTopics.evaluate((element) => element.open))) {
      await mobileTopics.locator("summary").click();
    }
    await statusTopic.click();
    await expect(statusTopic).toHaveAttribute("aria-current", "location");
    await search.fill("");
    await expectNoHorizontalOverflow(page);
  }
});
