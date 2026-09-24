import { NextResponse } from "next/server";

import { syncOrganizationMembership } from "@/lib/organization-accounts";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { findCredential, isPlausibleEmail, loadDirectoryUser, normalizeEmail, recordLogin, verifyAgainstDummyHash, verifyPassword } from "@/lib/registration";
import { COOKIE_NAME, createSessionToken } from "@/lib/session";

const INVALID = "Incorrect email or password.";

export async function POST(request: Request) {
  const rate = consumeRateLimit(`login:${requestClientKey(request)}`, 10, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many login attempts. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    const password = typeof body?.password === "string" ? body.password : "";
    if (!isPlausibleEmail(email) || !password || password.length > 128) return NextResponse.json({ error: INVALID }, { status: 401 });

    const perEmail = consumeRateLimit(`login-email:${email}`, 8, 15 * 60 * 1000);
    if (!perEmail.allowed) return NextResponse.json({ error: "Too many login attempts. Try again later." }, { status: 429, headers: rateLimitHeaders(perEmail) });

    const credential = await findCredential(email);
    if (!credential) {
      await verifyAgainstDummyHash(password);
      return NextResponse.json({ error: INVALID }, { status: 401 });
    }
    if (!(await verifyPassword(password, credential.passwordHash))) return NextResponse.json({ error: INVALID }, { status: 401 });
    if (!credential.verified) {
      return NextResponse.json({ error: "Please verify your email first. Check your inbox for the verification link.", needsVerification: true }, { status: 403 });
    }

    const directoryUser = await loadDirectoryUser(email, credential.organizationId);
    if (!directoryUser) return NextResponse.json({ error: "Your account is not set up in this organization's directory. Contact your HR administrator." }, { status: 403 });
    if (directoryUser.active !== true) return NextResponse.json({ error: "Your recruitment portal account is inactive." }, { status: 403 });

    await syncOrganizationMembership({ organizationId: credential.organizationId, email, active: true });
    await recordLogin(credential.id);

    const token = createSessionToken({
      sub: credential.id,
      name: directoryUser.fullName || credential.fullName || email,
      email,
      organizationId: credential.organizationId,
      active: directoryUser.active,
      accessRole: directoryUser.accessRole,
      department: directoryUser.department,
      canCreateRole: directoryUser.canCreateRole,
      canReviewRole: directoryUser.canReviewRole,
      canApproveRole: directoryUser.canApproveRole,
      canEditSettings: directoryUser.canEditSettings,
      canManageUsers: directoryUser.canManageUsers,
      canManageCredits: directoryUser.canManageCredits,
      canReviewDepartmentRole: directoryUser.canReviewDepartmentRole,
    });

    const response = NextResponse.json({ success: true });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    return response;
  } catch (error) {
    console.error("[Login] Failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Login failed. Please try again." }, { status: 500 });
  }
}
