import { NextResponse } from "next/server";

import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { getPublicAppBaseUrl } from "@/lib/public-url";
import { isPlausibleEmail, normalizeEmail, passwordProblem, registerUser, sendVerificationEmail } from "@/lib/registration";

export async function POST(request: Request) {
  const rate = consumeRateLimit(`register:${requestClientKey(request)}`, 5, 60 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many registration attempts. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    const fullName = typeof body?.fullName === "string" ? body.fullName.trim().slice(0, 120) : "";
    if (!isPlausibleEmail(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    if (!fullName) return NextResponse.json({ error: "Enter your full name." }, { status: 400 });
    const problem = passwordProblem(body?.password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const result = await registerUser({ email, fullName, password: body.password });
    if (result.status === "not_eligible") {
      return NextResponse.json({ error: "Registration is limited to members of a participating organization. Use your organization email address." }, { status: 403 });
    }
    if (result.status === "verification_pending") {
      return NextResponse.json({ error: "A verification request is already pending for this email. The link is valid for 24 hours. Check your inbox or choose Resend verification email.", needsVerification: true }, { status: 409 });
    }
    if (result.status === "already_registered") {
      return NextResponse.json({ error: "An account already exists for this email. Log in instead." }, { status: 409 });
    }

    const link = `${getPublicAppBaseUrl(request)}/api/auth/verify?token=${encodeURIComponent(result.token)}`;
    const sent = await sendVerificationEmail({ email, fullName, link });
    if (sent.status !== "sent") {
      console.error("[Register] Verification email not sent:", sent.status, sent.error || "");
      return NextResponse.json({ success: true, emailSent: false, needsVerification: true, message: "Your account was created, but the verification email could not be sent. The verification request remains valid for 24 hours. Use Resend verification email to try again." });
    }
    return NextResponse.json({ success: true, emailSent: true, needsVerification: true, message: "Check your email for a verification link. It expires in 24 hours. You can log in once it is confirmed." });
  } catch (error) {
    console.error("[Register] Failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Registration failed. Please try again." }, { status: 500 });
  }
}
