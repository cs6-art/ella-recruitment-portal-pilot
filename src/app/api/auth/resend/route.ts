import { NextResponse } from "next/server";

import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { getPublicAppBaseUrl } from "@/lib/public-url";
import { isPlausibleEmail, normalizeEmail, reissueVerification, sendVerificationEmail } from "@/lib/registration";

export async function POST(request: Request) {
  const rate = consumeRateLimit(`resend:${requestClientKey(request)}`, 5, 60 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  // Same response whether or not the email exists, so this cannot be used to probe accounts.
  const generic = { success: true, message: "If that email has a pending registration, a new verification link has been sent." };
  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    if (!isPlausibleEmail(email)) return NextResponse.json(generic);
    const own = consumeRateLimit(`resend-email:${email}`, 3, 60 * 60 * 1000);
    if (!own.allowed) return NextResponse.json(generic);

    const reissued = await reissueVerification(email);
    if (reissued) {
      const link = `${getPublicAppBaseUrl(request)}/api/auth/verify?token=${encodeURIComponent(reissued.token)}`;
      const sent = await sendVerificationEmail({ email, fullName: reissued.fullName, link });
      if (sent.status !== "sent") console.error("[Resend] Verification email not sent:", sent.status, sent.error || "");
    }
    return NextResponse.json(generic);
  } catch (error) {
    console.error("[Resend] Failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(generic);
  }
}
