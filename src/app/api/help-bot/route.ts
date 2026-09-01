import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import OpenAI from "openai";

import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { retrieveContext } from "@/lib/help-bot/knowledge";
import { HELP_BOT_SYSTEM_PROMPT, buildUserPrompt } from "@/lib/help-bot/prompt";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

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

// The feature and its provider config are tracked separately so the widget can
// ship (visible, openable) before OPENAI_API_KEY is set. HELP_BOT_ENABLED is the
// hard kill switch; isConfigured() gates the actual model call.
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

  // Deployed but not yet provisioned with a provider key: answer with the
  // "being configured" notice and make no OpenAI call.
  if (!isConfigured()) {
    return NextResponse.json(
      { success: false, code: "NOT_CONFIGURED", error: "Ella Help is currently being configured and will be available soon." },
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

  const history = sanitizeHistory((payload as { history?: unknown })?.history);
  const context = retrieveContext(question);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    // OpenAI Responses API. `instructions` carries the strict grounding /
    // anti-injection system prompt; `input` is the prior turns plus the
    // knowledge-grounded user prompt. Only the static knowledge sections and
    // the user's question reach the model — no live portal data.
    const response = await client.responses.create({
      model: process.env.HELP_BOT_MODEL || DEFAULT_MODEL,
      max_output_tokens: 700,
      instructions: HELP_BOT_SYSTEM_PROMPT,
      input: [
        ...history,
        { role: "user", content: buildUserPrompt(context, question) },
      ],
    });

    const answer = (response.output_text || "").trim();

    if (!answer) {
      return NextResponse.json(
        { success: false, error: "The assistant could not produce an answer. Please rephrase your question." },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { success: true, answer, sources: context.sections.map((section) => section.heading) },
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
