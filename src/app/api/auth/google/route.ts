import { OAuth2Client } from "google-auth-library";
import { NextResponse } from "next/server";

import { findDirectoryUser } from "@/lib/google-sheets";
import { getPortalConfigValue } from "@/lib/portal-config";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, createSessionToken } from "@/lib/session";

const client = new OAuth2Client();

export async function POST(request: Request) {
  console.log("\n[Login] Route started");

  const rate = consumeRateLimit(`login:${requestClientKey(request)}`, 10, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many login attempts. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  try {
    const body = await request.json();
    const credential = body?.credential;

    console.log("[Login] Credential received:", Boolean(credential));

    if (!credential || typeof credential !== "string") {
      console.log("[Login] Rejected: missing Google credential");

      return NextResponse.json(
        { error: "Missing Google credential." },
        { status: 400 },
      );
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const allowedDomain =
      (await getPortalConfigValue("Allowed_Google_Domain")) || "mclinkgroup.com";

    console.log("[Login] Configuration:", {
      clientIdConfigured: Boolean(clientId),
      allowedDomain,
    });

    if (!clientId) {
      throw new Error("GOOGLE_CLIENT_ID is not configured.");
    }

    console.log("[Login] Verifying Google token");

    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });

    const payload = ticket.getPayload();

    console.log("[Login] Google token result:", {
      hasSubject: Boolean(payload?.sub),
      email: payload?.email,
      emailVerified: payload?.email_verified,
      hostedDomain: payload?.hd,
      name: payload?.name,
    });

    if (!payload?.sub) {
      console.log("[Login] Rejected: Google account ID missing");

      return NextResponse.json(
        { error: "Google account ID is missing." },
        { status: 403 },
      );
    }

    if (!payload.email) {
      console.log("[Login] Rejected: Google email missing");

      return NextResponse.json(
        { error: "Google account email is missing." },
        { status: 403 },
      );
    }

    if (payload.email_verified !== true) {
      console.log("[Login] Rejected: Google email not verified");

      return NextResponse.json(
        { error: "Your Google email is not verified." },
        { status: 403 },
      );
    }

    if (String(payload.hd || "").trim().toLowerCase() !== allowedDomain.trim().toLowerCase()) {
      console.log("[Login] Rejected: invalid Workspace domain", {
        receivedDomain: payload.hd,
        expectedDomain: allowedDomain,
      });

      return NextResponse.json(
        {
          error: `Only verified ${allowedDomain} Google Workspace accounts are allowed.`,
        },
        { status: 403 },
      );
    }

    const normalizedEmail = payload.email.trim().toLowerCase();

    console.log("[Login] Looking up User_Directory:", normalizedEmail);

    const directoryUser = await findDirectoryUser(normalizedEmail);

    console.log("[Login] User_Directory result:", {
      found: Boolean(directoryUser),
      email: directoryUser?.email,
      fullName: directoryUser?.fullName,
      accessRole: directoryUser?.accessRole,
      department: directoryUser?.department,
      canCreateRole: directoryUser?.canCreateRole,
      canReviewRole: directoryUser?.canReviewRole,
      canApproveRole: directoryUser?.canApproveRole,
      canEditSettings: directoryUser?.canEditSettings,
      canManageUsers: directoryUser?.canManageUsers,
      active: directoryUser?.active,
    });

    if (!directoryUser) {
      console.log("[Login] Rejected: user not found in User_Directory");

      return NextResponse.json(
        {
          error:
            "Your account is not listed in the recruitment portal user directory.",
        },
        { status: 403 },
      );
    }

    if (directoryUser.active !== true) {
      console.log("[Login] Rejected: User_Directory account inactive");

      return NextResponse.json(
        {
          error: "Your recruitment portal account is inactive.",
        },
        { status: 403 },
      );
    }

    console.log("[Login] Creating session for:", normalizedEmail);

    const token = createSessionToken({
      sub: payload.sub,
      name:
        directoryUser.fullName ||
        payload.name ||
        normalizedEmail,
      email: normalizedEmail,
      picture: payload.picture,
      active: directoryUser.active,

      accessRole: directoryUser.accessRole,
      department: directoryUser.department,
      canCreateRole: directoryUser.canCreateRole,
      canReviewRole: directoryUser.canReviewRole,
      canApproveRole: directoryUser.canApproveRole,
      canEditSettings: directoryUser.canEditSettings,
      canManageUsers: directoryUser.canManageUsers,
      canReviewDepartmentRole: directoryUser.canReviewDepartmentRole,
    });

    const response = NextResponse.json({
      success: true,
      user: {
        name: directoryUser.fullName,
        email: directoryUser.email,
        accessRole: directoryUser.accessRole,
        department: directoryUser.department,
        canCreateRole: directoryUser.canCreateRole,
        canReviewRole: directoryUser.canReviewRole,
        canApproveRole: directoryUser.canApproveRole,
        canEditSettings: directoryUser.canEditSettings,
        canManageUsers: directoryUser.canManageUsers,
        canReviewDepartmentRole: directoryUser.canReviewDepartmentRole,
        active: directoryUser.active,
      },
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60,
    });

    console.log("[Login] Success:", {
      email: normalizedEmail,
      accessRole: directoryUser.accessRole,
      department: directoryUser.department,
    });

    return response;
  } catch (error) {
    console.error("[Login] Google authentication error:", error);

    if (error instanceof Error) {
      console.error("[Login] Error details:", {
        name: error.name,
        message: error.message,
      });
    }

    return NextResponse.json(
      { error: "Google authentication failed." },
      { status: 401 },
    );
  }
}
