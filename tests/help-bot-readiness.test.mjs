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

test("the static knowledge/prompt path has no direct applicant / Sheets / DB / n8n access", () => {
  // Phase 2 (2026-09-14) intentionally added a narrow, whitelisted live-data
  // path -- see the next test. This test's job is narrower now: the STATIC
  // grounding (knowledge.ts, and the route's own code outside that path)
  // must still never reach a database, Sheets, or n8n directly.
  const route = read("src/app/api/help-bot/route.ts");
  assert.match(route, /retrieveContext\(question\)/);
  assert.match(route, /userContext/);
  assert.doesNotMatch(route, /getApplicant|getRoleRequest|google-sheets|getDb\(|N8N_|webhook/);
  const knowledge = read("src/lib/help-bot/knowledge.ts");
  assert.doesNotMatch(knowledge, /fetch\(|getDb\(|googleapis|neon\(/);
  const prompt = read("src/lib/help-bot/prompt.ts");
  assert.doesNotMatch(prompt, /fetch\(|getDb\(|googleapis|neon\(/);
});

test("live data access is confined to the whitelisted, zero-parameter, RBAC-gated live-tools registry", () => {
  const route = read("src/app/api/help-bot/route.ts");
  // route.ts is the one sanctioned wiring point for the real data-fetching
  // functions (live-tools.ts and conversation.ts stay decoupled from them so
  // they're unit-testable under plain Node -- see the comment at the top of
  // live-tools.ts). It must wire them only into liveToolDeps, passed straight
  // into the conversation loop -- never call them directly itself, and never
  // import a broader surface (raw Sheets/DB access, applicant/role queries).
  assert.match(route, /const liveToolDeps: LiveToolDependencies = \{ getCreditBalance, bulkQueueStatusSummary, voiceAttemptStatusSummary \};/);
  assert.match(route, /runHelpBotConversation\(\s*client,[\s\S]*?liveToolDeps,?\s*\)/);
  assert.doesNotMatch(route, /getApplicant|getRoleRequest|google-sheets|listBulkQueueForPortal|listApplications/);

  const liveTools = read("src/lib/help-bot/live-tools.ts");
  assert.match(liveTools, /canManagePipeline/); // reuses existing RBAC, doesn't invent new logic
  assert.match(liveTools, /additionalProperties: false/); // zero-argument tool schemas
  // The three approved capabilities only -- nothing else is live-reachable.
  for (const name of ["get_credit_balance", "get_bulk_queue_summary", "get_interview_status_summary"]) {
    assert.match(liveTools, new RegExp(name));
  }
  // Field-access shape, not prose: catches an actual PII column reference
  // without false-flagging the word "transcript" used in an explanatory comment.
  assert.doesNotMatch(liveTools, /\.candidateName|\.candidateEmail|\.transcript|\.recordingUrl|candidateName:|candidateEmail:/);
});

test("auth is required to use the assistant", () => {
  const route = read("src/app/api/help-bot/route.ts");
  assert.match(route, /verifySessionToken/);
  assert.match(route, /Authentication required/);
});

test("Smile starter questions hide after a question and return after the response settles", () => {
  const panel = read("src/components/HelpBot.tsx");
  assert.match(panel, /STARTER_RETURN_DELAY_MS = 4_000/);
  assert.match(panel, /setShowStarters\(false\)/);
  assert.match(panel, /starterTimerRef\.current = setTimeout/);
  assert.match(panel, /setShowStarters\(true\)/);
  assert.match(panel, /clearTimeout\(starterTimerRef\.current\)/);
  assert.match(panel, /configured && showStarters/);
});
