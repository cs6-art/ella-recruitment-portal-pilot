import { NextResponse } from "next/server";

import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { getPublicAppBaseUrl } from "@/lib/public-url";
import { isPlausibleEmail, issuePasswordReset, normalizeEmail, sendPasswordResetEmail } from "@/lib/registration";

export async function POST(request: Request) {
  const rate = consumeRateLimit(`forgot:${requestClientKey(request)}`, 5, 60 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  // Identical response whether or not the account exists.
  const generic = { success: true, message: "If that email has an account, a password reset link has been sent." };
  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    if (!isPlausibleEmail(email)) return NextResponse.json(generic);
    if (!consumeRateLimit(`forgot-email:${email}`, 3, 60 * 60 * 1000).allowed) return NextResponse.json(generic);

    const issued = await issuePasswordReset(email);
    if (issued) {
      const link = `${getPublicAppBaseUrl(request)}/?reset=${encodeURIComponent(issued.token)}`;
      const sent = await sendPasswordResetEmail({ email, fullName: issued.fullName, link });
      if (sent.status !== "sent") console.error("[Forgot] Reset email not sent:", sent.status, sent.error || "");
    }
    return NextResponse.json(generic);
  } catch (error) {
    // An infrastructure failure says nothing about whether the account exists, so report it honestly.
    console.error("[Forgot] Failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "We couldn't process your request right now. Please try again later." }, { status: 503 });
  }
}
