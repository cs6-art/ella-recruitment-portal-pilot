import { canManagePipeline } from "../access-control.ts";
import type { SessionUser } from "../session.ts";

// Deliberately NO import of ella-credits.ts / internal-recruitment-queries.ts
// here (even type-only): those modules pull in a deep, "@/lib/..."-aliased
// dependency chain that only Next.js's webpack build resolves -- plain Node
// (which tests/help-bot-live-tools.test.mjs runs under) cannot. This module
// is directly test-imported, so it must stay fully self-contained: the real
// data-fetching functions are supplied by the caller (route.ts, which is
// never directly imported by a test) via LiveToolDependencies, not imported
// here. access-control.ts is safe to import directly -- it has no runtime
// dependencies of its own (its only imports are `import type`).

/**
 * Smile Help Bot — Phase 2 live-tools registry.
 *
 * This is the ONLY place the Help Bot may touch live system state. Every
 * function here is:
 *  - Zero-parameter. The model cannot pass an ID, filter, candidate name,
 *    role, organization, or any other selector — every value is derived
 *    server-side from the already-verified session (`SessionUser`), the same
 *    object every authenticated route in this app already trusts.
 *  - Aggregate-count-only where the data could otherwise carry PII (queue,
 *    interviews). No resume, transcript, recording, comment, score, or
 *    candidate name is ever selected by these functions, let alone returned.
 *  - Authorized using existing access-control helpers (canManagePipeline) —
 *    no new authorization rule is invented here.
 *  - Logged on every invocation (user, tool, timestamp, success/failure) —
 *    never the returned data.
 *
 * Do not add a tool here that accepts a parameter derived from user input or
 * model output. If a future capability needs a selector (e.g. "my own
 * applications"), it must still resolve that selector from the session
 * (e.g. the caller's own email), never accept it as a tool argument.
 */

export const LIVE_TOOL_NAMES = [
  "get_credit_balance",
  "get_bulk_queue_summary",
  "get_interview_status_summary",
] as const;

export type LiveToolName = (typeof LIVE_TOOL_NAMES)[number];

export const MAX_LIVE_TOOL_CALLS_PER_QUESTION = 2;

export type LiveToolResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: "not_authorized" | "unknown_tool" | "tool_call_limit_reached" | "internal_error" };

const TOOL_DESCRIPTIONS: Record<LiveToolName, string> = {
  get_credit_balance:
    "Get the signed-in user's organization's current Smile Credits balance. Takes no parameters. Use only when the user asks for their actual current balance, not for an explanation of how credits work.",
  get_bulk_queue_summary:
    "Get aggregate counts of the bulk resume screening queue, grouped by status (e.g. queued, processing, screened, failed, skipped), for the signed-in user's organization. Takes no parameters. Never returns candidate names or files. May be denied if the signed-in user lacks pipeline-management access.",
  get_interview_status_summary:
    "Get aggregate counts of voice interview attempts, grouped by status (e.g. scheduled, calling, completed, failed, no_show), for the signed-in user's organization. Takes no parameters. Never returns transcripts, recordings, scores, or candidate names. May be denied if the signed-in user lacks pipeline-management access.",
};

// Every schema is a strict, empty-object parameter list: `additionalProperties:
// false` plus `strict: true` makes it structurally impossible for the model to
// supply an argument, valid or not — there is nothing for the API to reject
// AND nothing for a tool implementation to accidentally trust.
export const LIVE_TOOL_SCHEMAS = LIVE_TOOL_NAMES.map((name) => ({
  type: "function" as const,
  name,
  description: TOOL_DESCRIPTIONS[name],
  parameters: { type: "object", properties: {}, additionalProperties: false, required: [] },
  strict: true,
}));

export type ToolInvocationLogEntry = {
  userEmail: string;
  tool: string;
  timestamp: string;
  success: boolean;
};

// In-memory, process-local invocation log. This is intentionally not a
// database table — it exists for operational visibility (console output) and
// for tests to assert logging happened; it is not an audit-of-record. It
// never stores the tool's returned data, only that a call happened and
// whether it succeeded.
const invocationLog: ToolInvocationLogEntry[] = [];
const MAX_RETAINED_LOG_ENTRIES = 500;

export function recentLiveToolInvocations(): readonly ToolInvocationLogEntry[] {
  return invocationLog;
}

/** Test-only reset so log-assertion tests don't leak state across runs. */
export function _resetLiveToolInvocationLogForTests(): void {
  invocationLog.length = 0;
}

function logInvocation(entry: ToolInvocationLogEntry) {
  invocationLog.push(entry);
  if (invocationLog.length > MAX_RETAINED_LOG_ENTRIES) invocationLog.splice(0, invocationLog.length - MAX_RETAINED_LOG_ENTRIES);
  // Deliberately logs only identity/tool/time/outcome -- never `data` or `reason`
  // details beyond the fact of denial, so a live balance/count never lands in
  // server logs.
  console.info(`[Help Bot live tool] ${entry.tool} ${entry.success ? "ok" : "denied"} user=${entry.userEmail} at=${entry.timestamp}`);
}

/**
 * The real data-fetching functions, supplied by the caller (route.ts) rather
 * than imported here -- see the note at the top of this file. Typed
 * structurally (not via `typeof` on an import) so this module has zero
 * runtime coupling to ella-credits.ts / internal-recruitment-queries.ts.
 * Tests supply fakes matching this same shape; production wiring lives in
 * route.ts, the one file in this feature that Next.js's build (not a test)
 * loads, so its "@/lib/..." imports resolve normally.
 */
export type LiveToolDependencies = {
  getCreditBalance: (scope: { organizationId: string; ownerEmail: string }) => Promise<{ balance: number }>;
  bulkQueueStatusSummary: (organizationId: string) => Promise<Record<string, number>>;
  voiceAttemptStatusSummary: (organizationId: string) => Promise<Record<string, number>>;
};

async function runTool(name: LiveToolName, user: SessionUser, deps: LiveToolDependencies): Promise<LiveToolResult> {
  switch (name) {
    case "get_credit_balance": {
      // Matches the existing /api/ella-credits/balance route's own rule: any
      // authenticated user may see their organization's balance. No
      // additional gate -- reusing that precedent verbatim, not inventing one.
      // A session missing its identity fields (malformed/degenerate, should
      // never happen post-verifySessionToken, but fail closed rather than
      // querying an empty-string organization) is denied rather than queried.
      if (!user.organizationId?.trim() || !user.email?.trim()) return { ok: false, reason: "not_authorized" };
      const { balance } = await deps.getCreditBalance({ organizationId: user.organizationId, ownerEmail: user.email });
      return { ok: true, data: { balance } };
    }
    case "get_bulk_queue_summary": {
      if (!canManagePipeline(user)) return { ok: false, reason: "not_authorized" };
      const counts = await deps.bulkQueueStatusSummary(user.organizationId);
      return { ok: true, data: { counts } };
    }
    case "get_interview_status_summary": {
      if (!canManagePipeline(user)) return { ok: false, reason: "not_authorized" };
      const counts = await deps.voiceAttemptStatusSummary(user.organizationId);
      return { ok: true, data: { counts } };
    }
  }
}

function isLiveToolName(value: string): value is LiveToolName {
  return (LIVE_TOOL_NAMES as readonly string[]).includes(value);
}

/**
 * Invoke one live tool by name for the given verified session. Always logs
 * the attempt. Never throws -- a failure becomes { ok: false }, so a caller
 * can always JSON-serialize the result straight back to the model as a
 * function_call_output.
 */
export async function invokeLiveTool(
  name: string,
  user: SessionUser,
  deps: LiveToolDependencies,
): Promise<LiveToolResult> {
  const timestamp = new Date().toISOString();
  if (!isLiveToolName(name)) {
    logInvocation({ userEmail: user.email, tool: name, timestamp, success: false });
    return { ok: false, reason: "unknown_tool" };
  }
  try {
    const result = await runTool(name, user, deps);
    logInvocation({ userEmail: user.email, tool: name, timestamp, success: result.ok });
    return result;
  } catch (error) {
    console.error("[Help Bot live tool] threw:", name, error);
    logInvocation({ userEmail: user.email, tool: name, timestamp, success: false });
    return { ok: false, reason: "internal_error" };
  }
}

/** Denial returned (and logged) without invoking anything, once the
 * per-question tool-call budget is spent. */
export function liveToolLimitReached(name: string, user: SessionUser): LiveToolResult {
  logInvocation({ userEmail: user.email, tool: name, timestamp: new Date().toISOString(), success: false });
  return { ok: false, reason: "tool_call_limit_reached" };
}
