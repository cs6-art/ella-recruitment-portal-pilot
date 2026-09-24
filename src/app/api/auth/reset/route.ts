import { NextResponse } from "next/server";

import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { passwordProblem, resetPassword } from "@/lib/registration";

export async function POST(request: Request) {
  const rate = consumeRateLimit(`reset:${requestClientKey(request)}`, 10, 60 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  try {
    const body = await request.json().catch(() => ({}));
    const problem = passwordProblem(body?.password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const result = await resetPassword(typeof body?.token === "string" ? body.token : "", body.password);
    if (result === "expired") return NextResponse.json({ error: "That reset link has expired. Request a new one." }, { status: 410 });
    if (result === "invalid") return NextResponse.json({ error: "That reset link is not valid or was already used." }, { status: 400 });
    return NextResponse.json({ success: true, message: "Password updated. You can now log in." });
  } catch (error) {
    console.error("[Reset] Failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not reset the password. Please try again." }, { status: 500 });
  }
}
