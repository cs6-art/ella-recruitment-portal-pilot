import { createHmac } from "node:crypto";
import fs from "node:fs";
import { test, expect } from "@playwright/test";

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
  canEditSettings: true,
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
  await expect(page.getByRole("heading", { name: "Create role request" })).toBeVisible();
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
  await expect(page).toHaveURL(/127\.0\.0\.1:3000\/$/);
});
