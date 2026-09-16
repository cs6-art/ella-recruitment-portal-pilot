import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import OpenAI from "openai";

import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { retrieveContext } from "@/lib/help-bot/knowledge";
import { directHelpAnswer, HELP_BOT_SYSTEM_PROMPT, buildUserPrompt, type HelpUserContext } from "@/lib/help-bot/prompt";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { runHelpBotConversation } from "@/lib/help-bot/conversation";
import type { LiveToolDependencies } from "@/lib/help-bot/live-tools";
import { getCreditBalance } from "@/lib/ella-credits";
import { bulkQueueStatusSummary, voiceAttemptStatusSummary } from "@/lib/internal-recruitment-queries";

// The one place the real live-tool implementations are wired in. live-tools.ts
// and conversation.ts stay decoupled from these (see the comment at the top of
// live-tools.ts) so they can be unit tested under plain Node without pulling
// in this module's "@/lib/..." dependency chain.
const liveToolDeps: LiveToolDependencies = { getCreditBalance, bulkQueueStatusSummary, voiceAttemptStatusSummary };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Low-cost OpenAI model — sufficient for grounded FAQ answers over the supplied
// knowledge sections. Override with HELP_BOT_MODEL. The API key is read only
// here, server-side; it is never sent to the browser and is not a NEXT_PUBLIC_ var.
const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_QUESTION_LENGTH = 600;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CHARS = 1200;

type ClientMessage = { role: "user" | "assistant"; content: string };

// Keep the widget visible unless an administrator explicitly disables it. The
// provider key controls readiness, not whether the UI is discoverable; the
// POST guard below remains fail-closed while the key is absent.
function isEnabled() {
  return process.env.HELP_BOT_ENABLED !== "false";
}

function isConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function sanitizeHistory(value: unknown): ClientMessage[] {
  if (!Array.isArray(value)) return [];
  const cleaned: ClientMessage[] = [];
  for (const entry of value.slice(-MAX_HISTORY_MESSAGES)) {
    if (!entry || typeof entry !== "object") continue;
    const role = (entry as ClientMessage).role;
    const content = (entry as ClientMessage).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const trimmed = content.trim().slice(0, MAX_HISTORY_CHARS);
    if (trimmed) cleaned.push({ role, content: trimmed });
  }
  return cleaned;
}

export async function GET() {
  const enabled = isEnabled();
  return NextResponse.json({ success: true, enabled, configured: enabled && isConfigured() });
}

export async function POST(request: Request) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) {
    return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  }

  if (!isEnabled()) {
    return NextResponse.json(
      { success: false, error: "The help assistant is not available right now." },
      { status: 503 },
    );
  }

  // Direct callers still receive a safe not-configured response if the key is
  // removed after the initial enabled check; no OpenAI call is made.
  if (!isConfigured()) {
    return NextResponse.json(
      { success: false, code: "NOT_CONFIGURED", error: "Smile is currently being configured and will be available soon." },
      { status: 503 },
    );
  }

  const rate = consumeRateLimit(
    `help-bot:${user.email}:${requestClientKey(request)}`,
    20,
    5 * 60 * 1000,
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "You've asked a lot of questions in a short time. Please wait a moment and try again." },
      { status: 429, headers: rateLimitHeaders(rate) },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }

  const question = String((payload as { question?: unknown })?.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ success: false, error: "Enter a question." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json(
      { success: false, error: `Please keep your question under ${MAX_QUESTION_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const userContext: HelpUserContext = {
    name: user.name,
    accessRole: user.accessRole,
    department: user.department,
    canCreateRole: user.canCreateRole,
    canReviewRole: user.canReviewRole,
    canApproveRole: user.canApproveRole,
    canEditSettings: user.canEditSettings,
    canManageUsers: user.canManageUsers,
    canManageCredits: user.canManageCredits,
    canReviewDepartmentRole: user.canReviewDepartmentRole,
  };

  const directAnswer = directHelpAnswer(question, userContext);
  if (directAnswer) {
    return NextResponse.json(
      { success: true, answer: directAnswer, sources: ["About Smile"] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const history = sanitizeHistory((payload as { history?: unknown })?.history);
  const context = retrieveContext(question);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    // OpenAI Responses API. `instructions` carries the strict grounding /
    // anti-injection system prompt; `input` is the prior turns plus the
    // knowledge-grounded user prompt. Static knowledge sections and the
    // user's question always reach the model; the model may additionally
    // request up to MAX_LIVE_TOOL_CALLS_PER_QUESTION calls into the
    // whitelisted, zero-parameter, RBAC-gated live-tools registry (see
    // src/lib/help-bot/live-tools.ts) — nothing else about the system's live
    // state is reachable from here.
    const { answer, toolCallsUsed } = await runHelpBotConversation(
      client,
      {
        model: process.env.HELP_BOT_MODEL || DEFAULT_MODEL,
        instructions: HELP_BOT_SYSTEM_PROMPT,
        input: [
          ...history,
          { role: "user", content: buildUserPrompt(context, question, userContext) },
        ],
      },
      user,
      liveToolDeps,
    );

    if (!answer) {
      return NextResponse.json(
        { success: false, error: "The assistant could not produce an answer. Please rephrase your question." },
        { status: 502 },
      );
    }

    const sources = context.sections.map((section) => section.heading);
    if (toolCallsUsed > 0) sources.push("Live portal data");

    return NextResponse.json(
      { success: true, answer, sources },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof OpenAI.RateLimitError) {
      return NextResponse.json(
        { success: false, error: "The assistant is busy right now. Please try again in a minute." },
        { status: 429 },
      );
    }
    console.error("[API Help Bot] request failed:", error);
    return NextResponse.json(
      { success: false, error: "The assistant is temporarily unavailable. Please try again later." },
      { status: 502 },
    );
  }
}
