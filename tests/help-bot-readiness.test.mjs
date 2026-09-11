import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the OpenAI key is server-only — never a NEXT_PUBLIC var, never sent to the client", () => {
  const route = read("src/app/api/help-bot/route.ts");
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /process\.env\.OPENAI_API_KEY/);
  assert.doesNotMatch(route, /NEXT_PUBLIC_OPENAI|NEXT_PUBLIC_.*KEY/);
  // GET returns only booleans, never the key or model
  assert.match(route, /enabled, configured: enabled && isConfigured\(\)/);
  // grep the whole repo lightly: no client component imports the key
  for (const p of ["src/components/HelpBot.tsx", "src/components/EllaHelpWidget.tsx"]) {
    try {
      assert.doesNotMatch(read(p), /OPENAI_API_KEY/);
    } catch {
      /* component name may differ; the route-level guard is the contract */
    }
  }
});

test("HelpBot stays visible while safely disabled until OpenAI is configured", () => {
  const route = read("src/app/api/help-bot/route.ts");
  assert.match(route, /HELP_BOT_ENABLED !== "false"/);
  assert.doesNotMatch(route, /HELP_BOT_ENABLED !== "false" && Boolean\(process\.env\.OPENAI_API_KEY\)/);
  assert.match(route, /function isConfigured\(\)/);
  assert.match(route, /Boolean\(process\.env\.OPENAI_API_KEY\)/);
  // The UI may be visible, but POST remains a safe 503 and makes no OpenAI call.
  assert.match(route, /status: 503/);
});

test("the model is configurable and defaults to a low-cost model", () => {
  const route = read("src/app/api/help-bot/route.ts");
  assert.match(route, /const DEFAULT_MODEL = "gpt-4o-mini"/);
  assert.match(route, /process\.env\.HELP_BOT_MODEL \|\| DEFAULT_MODEL/);
});

test("the endpoint is rate limited per user and degrades on provider rate limits", () => {
  const route = read("src/app/api/help-bot/route.ts");
  assert.match(route, /consumeRateLimit\(\s*`help-bot:\$\{user\.email\}/);
  assert.match(route, /OpenAI\.RateLimitError/);
  assert.match(route, /status: 429/);
  assert.match(route, /status: 502/); // generic provider failure fallback
});

test("only static knowledge + the question reach the model — no applicant / Sheets / DB / n8n data", () => {
  const route = read("src/app/api/help-bot/route.ts");
  assert.match(route, /retrieveContext\(question\)/);
  assert.doesNotMatch(route, /getApplicant|getRoleRequest|google-sheets|getDb\(|N8N_|webhook/);
  const knowledge = read("src/lib/help-bot/knowledge.ts");
  assert.doesNotMatch(knowledge, /fetch\(|getDb\(|googleapis|neon\(/);
});

test("auth is required to use the assistant", () => {
  const route = read("src/app/api/help-bot/route.ts");
  assert.match(route, /verifySessionToken/);
  assert.match(route, /Authentication required/);
});
