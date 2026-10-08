import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isPlatformAdmin } from "@/lib/access-control";
import { parseFeedback } from "@/lib/feedback";
import { listFeedback, saveFeedback } from "@/lib/feedback-store";
import { consumeRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...(headers || {}) } });
}

/** Any signed-in person can leave feedback. Their organization and identity come from the session. */
export async function POST(request: Request) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return json({ success: false, error: "Please sign in to send feedback." }, 401);
  const rate = consumeRateLimit(`feedback:${user.organizationId}:${user.email.trim().toLowerCase()}`, 10, 15 * 60 * 1000);
  if (!rate.allowed) return json({ success: false, error: "You have sent feedback several times just now. Please try again in a few minutes." }, 429, rateLimitHeaders(rate));
  const parsed = parseFeedback(await request.json().catch(() => null));
  if (!parsed.ok) return json({ success: false, error: parsed.error }, 400);
  try {
    await saveFeedback({ organizationId: user.organizationId, email: user.email, name: user.name || "" }, parsed.value);
    return json({ success: true });
  } catch (error) {
    console.error("[API Feedback] save failed:", error instanceof Error ? error.message : error);
    return json({ success: false, error: "We couldn't save your feedback." }, 500);
  }
}

/** McLink platform administrators read all feedback; nobody else can. */
export async function GET() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return json({ success: false, error: "Authentication required." }, 401);
  if (!isPlatformAdmin(user)) return json({ success: false, error: "Only a McLink platform administrator can view feedback." }, 403);
  try {
    return json({ success: true, feedback: await listFeedback() });
  } catch (error) {
    console.error("[API Feedback] list failed:", error instanceof Error ? error.message : error);
    return json({ success: false, error: "Unable to load feedback." }, 500);
  }
}
