import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  invokeLiveTool,
  liveToolLimitReached,
  LIVE_TOOL_NAMES,
  LIVE_TOOL_SCHEMAS,
  MAX_LIVE_TOOL_CALLS_PER_QUESTION,
  recentLiveToolInvocations,
  _resetLiveToolInvocationLogForTests,
} from "../src/lib/help-bot/live-tools.ts";
import { runHelpBotConversation, partitionToolCallsByBudget } from "../src/lib/help-bot/conversation.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const HR_USER = {
  sub: "1", name: "HR User", email: "hr@example.com", organizationId: "org-1", exp: 0,
  accessRole: "HR", department: "AI",
  canCreateRole: false, canReviewRole: true, canApproveRole: false, canEditSettings: false,
};

const CREATOR_USER = {
  sub: "2", name: "Creator User", email: "creator@example.com", organizationId: "org-1", exp: 0,
  accessRole: "Creator", department: "Sales",
  canCreateRole: true, canReviewRole: false, canApproveRole: false, canEditSettings: false,
};

function fakeDeps(overrides = {}) {
  const calls = { getCreditBalance: 0, bulkQueueStatusSummary: 0, voiceAttemptStatusSummary: 0 };
  const deps = {
    getCreditBalance: async () => { calls.getCreditBalance += 1; return { balance: 347 }; },
    bulkQueueStatusSummary: async () => { calls.bulkQueueStatusSummary += 1; return { queued: 2, processing: 1, screened: 5 }; },
    voiceAttemptStatusSummary: async () => { calls.voiceAttemptStatusSummary += 1; return { scheduled: 1, completed: 3, no_show: 1 }; },
    ...overrides,
  };
  return { deps, calls };
}

test("authorized credit balance query returns the balance", async () => {
  const { deps, calls } = fakeDeps();
  const result = await invokeLiveTool("get_credit_balance", HR_USER, deps);
  assert.deepEqual(result, { ok: true, data: { balance: 347 } });
  assert.equal(calls.getCreditBalance, 1);
});

test("unauthorized (malformed session) credit balance query is denied without querying anything", async () => {
  const { deps, calls } = fakeDeps();
  const noOrg = { ...HR_USER, organizationId: "" };
  const result = await invokeLiveTool("get_credit_balance", noOrg, deps);
  assert.deepEqual(result, { ok: false, reason: "not_authorized" });
  assert.equal(calls.getCreditBalance, 0, "must fail closed before ever calling the data source");
});

test("queue summary returns aggregate counts only, nothing else", async () => {
  const { deps } = fakeDeps();
  const result = await invokeLiveTool("get_bulk_queue_summary", HR_USER, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data), ["counts"]);
  assert.deepEqual(result.data.counts, { queued: 2, processing: 1, screened: 5 });
  for (const value of Object.values(result.data.counts)) assert.equal(typeof value, "number");
});

test("interview summary returns aggregate counts only, nothing else", async () => {
  const { deps } = fakeDeps();
  const result = await invokeLiveTool("get_interview_status_summary", HR_USER, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data), ["counts"]);
  assert.deepEqual(result.data.counts, { scheduled: 1, completed: 3, no_show: 1 });
  for (const value of Object.values(result.data.counts)) assert.equal(typeof value, "number");
});

test("no candidate names or PII can flow through the aggregate tools, even if a data source tried to include some", async () => {
  const { deps } = fakeDeps({
    // Simulates a hypothetical future bug in the data source: extra fields
    // beyond status->count. The tool wrapper must not add a second top-level
    // key alongside `counts` for either aggregate tool.
    bulkQueueStatusSummary: async () => ({ queued: 1 }),
    voiceAttemptStatusSummary: async () => ({ completed: 1 }),
  });
  const queue = await invokeLiveTool("get_bulk_queue_summary", HR_USER, deps);
  const interview = await invokeLiveTool("get_interview_status_summary", HR_USER, deps);
  assert.deepEqual(Object.keys(queue.data), ["counts"]);
  assert.deepEqual(Object.keys(interview.data), ["counts"]);

  // The underlying SQL itself must only ever select status + a count -- never
  // a candidate name, email, filename, transcript, or score column.
  const queries = read("src/lib/internal-recruitment-queries.ts");
  const queueStart = queries.indexOf("export async function bulkQueueStatusSummary");
  const interviewStart = queries.indexOf("export async function voiceAttemptStatusSummary");
  const interviewEnd = queries.indexOf("export async function listBulkQueueForPortal");
  assert.ok(queueStart > 0 && interviewStart > queueStart && interviewEnd > interviewStart, "expected function boundaries to be found");
  const queueFn = queries.slice(queueStart, interviewStart);
  const interviewFn = queries.slice(interviewStart, interviewEnd);
  for (const fn of [queueFn, interviewFn]) {
    assert.match(fn, /count\(\*\)/);
    // Field-access shape, not prose: the doc comments above each function
    // legitimately use words like "transcript" and "candidate name" in
    // English to say what ISN'T touched -- only flag an actual column
    // reference (e.g. `.candidateName`, `.transcript`).
    assert.doesNotMatch(fn, /\.candidateName|\.candidateEmail|\.transcript|\.recordingUrl|\.score\b|\.preferredMobile/);
  }
});

test("no arbitrary IDs, filters, or selectors can be passed into any live tool", () => {
  assert.equal(LIVE_TOOL_SCHEMAS.length, LIVE_TOOL_NAMES.length);
  for (const schema of LIVE_TOOL_SCHEMAS) {
    assert.equal(schema.type, "function");
    assert.equal(schema.strict, true);
    assert.deepEqual(schema.parameters, { type: "object", properties: {}, additionalProperties: false, required: [] });
  }
});

test("RBAC is enforced server-side for the pipeline-scoped live tools, not client-suppliable", async () => {
  const { deps, calls } = fakeDeps();
  const queueResult = await invokeLiveTool("get_bulk_queue_summary", CREATOR_USER, deps);
  const interviewResult = await invokeLiveTool("get_interview_status_summary", CREATOR_USER, deps);
  assert.deepEqual(queueResult, { ok: false, reason: "not_authorized" });
  assert.deepEqual(interviewResult, { ok: false, reason: "not_authorized" });
  assert.equal(calls.bulkQueueStatusSummary, 0, "must fail closed before querying");
  assert.equal(calls.voiceAttemptStatusSummary, 0, "must fail closed before querying");

  // The same user, same tools, succeed once they hold the reused RBAC gate --
  // proving the denial above was the real access-control.ts rule, not a stub.
  const { deps: hrDeps } = fakeDeps();
  const asHr = await invokeLiveTool("get_bulk_queue_summary", HR_USER, hrDeps);
  assert.equal(asHr.ok, true);
});

test("an unknown tool name is denied, not silently ignored or passed through", async () => {
  const { deps } = fakeDeps();
  const result = await invokeLiveTool("drop_all_applications", HR_USER, deps);
  assert.deepEqual(result, { ok: false, reason: "unknown_tool" });
});

test("partitionToolCallsByBudget enforces the hard per-question cap", () => {
  const calls = ["a", "b", "c", "d"];
  const fresh = partitionToolCallsByBudget(calls, 0);
  assert.deepEqual(fresh.toInvoke, calls.slice(0, MAX_LIVE_TOOL_CALLS_PER_QUESTION));
  assert.deepEqual(fresh.toDeny, calls.slice(MAX_LIVE_TOOL_CALLS_PER_QUESTION));

  const exhausted = partitionToolCallsByBudget(calls, MAX_LIVE_TOOL_CALLS_PER_QUESTION);
  assert.deepEqual(exhausted.toInvoke, []);
  assert.deepEqual(exhausted.toDeny, calls);
});

test("the conversation loop invokes at most MAX_LIVE_TOOL_CALLS_PER_QUESTION real tools per question, even when the model requests more", async () => {
  const { deps, calls } = fakeDeps();
  let round = 0;
  const fakeClient = {
    responses: {
      create: async () => {
        round += 1;
        if (round === 1) {
          // The model asks for three tool calls in a single round -- one more
          // than the budget allows.
          return {
            output: [
              { type: "function_call", call_id: "call_1", name: "get_credit_balance" },
              { type: "function_call", call_id: "call_2", name: "get_bulk_queue_summary" },
              { type: "function_call", call_id: "call_3", name: "get_interview_status_summary" },
            ],
          };
        }
        return { output: [], output_text: "Your balance is 347 credits." };
      },
    },
  };

  const { answer, toolCallsUsed } = await runHelpBotConversation(
    fakeClient,
    { model: "test-model", instructions: "test", input: [] },
    HR_USER,
    deps,
  );

  assert.equal(toolCallsUsed, MAX_LIVE_TOOL_CALLS_PER_QUESTION);
  assert.equal(calls.getCreditBalance + calls.bulkQueueStatusSummary, MAX_LIVE_TOOL_CALLS_PER_QUESTION, "only the budgeted calls reach a data source");
  assert.equal(calls.voiceAttemptStatusSummary, 0, "the third, over-budget call must never reach its data source");
  assert.equal(answer, "Your balance is 347 credits.");
});

test("tool invocation logging records user, tool, timestamp, and success/failure -- never the returned data", async () => {
  _resetLiveToolInvocationLogForTests();
  const { deps } = fakeDeps();
  await invokeLiveTool("get_credit_balance", HR_USER, deps);
  await invokeLiveTool("get_bulk_queue_summary", CREATOR_USER, deps); // denied
  liveToolLimitReached("get_interview_status_summary", HR_USER); // limit-denied path

  const log = recentLiveToolInvocations();
  assert.equal(log.length, 3);

  assert.deepEqual(Object.keys(log[0]).sort(), ["success", "timestamp", "tool", "userEmail"]);
  assert.equal(log[0].tool, "get_credit_balance");
  assert.equal(log[0].userEmail, HR_USER.email);
  assert.equal(log[0].success, true);
  assert.match(log[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);

  assert.equal(log[1].tool, "get_bulk_queue_summary");
  assert.equal(log[1].userEmail, CREATOR_USER.email);
  assert.equal(log[1].success, false);

  assert.equal(log[2].tool, "get_interview_status_summary");
  assert.equal(log[2].success, false);

  // Never the actual balance/counts -- only the fixed four keys above, on
  // every entry, no matter which tool or outcome.
  const serialized = JSON.stringify(log);
  assert.doesNotMatch(serialized, /347|queued|scheduled/);
});

test("existing static Help Bot behavior is unaffected by the live-tools addition", () => {
  // Sanity cross-check that the static path (knowledge.ts / prompt.ts) still
  // has no direct DB/Sheets/n8n import -- only live-tools.ts and
  // conversation.ts (which route.ts calls into) may reach live data. The full
  // regression suite for the static path lives in help-bot-knowledge.test.mjs
  // and help-bot-readiness.test.mjs.
  const knowledge = read("src/lib/help-bot/knowledge.ts");
  const prompt = read("src/lib/help-bot/prompt.ts");
  for (const source of [knowledge, prompt]) {
    assert.doesNotMatch(source, /getDb\(|googleapis|internal-recruitment-queries|ella-credits(?!-limits)/);
  }
});
