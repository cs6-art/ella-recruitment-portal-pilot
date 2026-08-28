import assert from "node:assert/strict";
import test from "node:test";

import {
  PORTAL_CONFIG_CATALOG,
  isEnabledChoice,
  resolvePortalConfigValue,
} from "../src/lib/portal-config-catalog.ts";

test("a non-empty Settings value wins over env and default", () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://env.example.com";
  const result = resolvePortalConfigValue("App_URL", [{ key: "App_URL", value: "https://sheet.example.com" }]);
  assert.equal(result.value, "https://sheet.example.com");
  assert.equal(result.source, "sheet");
  delete process.env.NEXT_PUBLIC_APP_URL;
});

test("env var is used when the Settings value is blank", () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://env.example.com";
  const result = resolvePortalConfigValue("App_URL", [{ key: "App_URL", value: "   " }]);
  assert.equal(result.value, "https://env.example.com");
  assert.equal(result.source, "env");
  delete process.env.NEXT_PUBLIC_APP_URL;
});

test("catalog default is the last resort", () => {
  delete process.env.ALLOWED_GOOGLE_DOMAIN;
  const result = resolvePortalConfigValue("Allowed_Google_Domain", []);
  assert.equal(result.value, "mclinkgroup.com");
  assert.equal(result.source, "default");
});

test("the first defined env fallback wins", () => {
  delete process.env.N8N_ROLE_REQUEST_WEBHOOK_URL;
  process.env.N8N_ROLE_WEBHOOK_URL = "https://legacy.example.com/webhook";
  assert.equal(resolvePortalConfigValue("N8N_Role_Webhook_URL", []).value, "https://legacy.example.com/webhook");
  process.env.N8N_ROLE_REQUEST_WEBHOOK_URL = "https://primary.example.com/webhook";
  assert.equal(resolvePortalConfigValue("N8N_Role_Webhook_URL", []).value, "https://primary.example.com/webhook");
  delete process.env.N8N_ROLE_REQUEST_WEBHOOK_URL;
  delete process.env.N8N_ROLE_WEBHOOK_URL;
});

test("credit-cost keys default to the pricing model with no env fallback", () => {
  assert.equal(resolvePortalConfigValue("Ella_Credit_Cost_CV_Analysis", []).value, "1");
  assert.equal(resolvePortalConfigValue("Ella_Credit_Cost_Phone_Interview", []).value, "10");
});

test("every catalog entry has a unique key and a sane shape", () => {
  const keys = new Set();
  for (const entry of PORTAL_CONFIG_CATALOG) {
    assert.ok(!keys.has(entry.key), `duplicate key ${entry.key}`);
    keys.add(entry.key);
    assert.ok(["text", "url", "number", "choice"].includes(entry.type));
    assert.equal(typeof entry.default, "string");
    assert.ok(Array.isArray(entry.envKeys));
  }
});

test("isEnabledChoice reads Yes/true/on/1", () => {
  assert.equal(isEnabledChoice("Yes"), true);
  assert.equal(isEnabledChoice("no"), false);
  assert.equal(isEnabledChoice(""), false);
  assert.equal(isEnabledChoice("true"), true);
});
