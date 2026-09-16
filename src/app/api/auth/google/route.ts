import { OAuth2Client } from "google-auth-library";
import { NextResponse } from "next/server";

import { findDirectoryUser } from "@/lib/google-sheets";
import { DEFAULT_ORGANIZATION_ID, resolveOrganizationForLogin, syncOrganizationMembership } from "@/lib/organization-accounts";
import { findPostgresDirectoryUser, findPostgresDirectoryUserByEmail } from "@/lib/postgres-directory";
import { runWithTenantDatabase } from "@/lib/tenant-database";
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

    console.log("[Login] Configuration:", {
      clientIdConfigured: Boolean(clientId),
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

    const normalizedEmail = payload.email.trim().toLowerCase();
    console.log("[Login] Looking up User_Directory:", normalizedEmail);

    // The directory, not the Google hosted domain, is the access boundary.
    // Sheet rows belong to the default tenant; Postgres rows carry their own
    // tenant. Only an active Sheet row claims McLink's default tenant, so a
    // deactivated legacy row can fall through to an active client membership.
    const sheetDirectoryUser = await findDirectoryUser(normalizedEmail);
    let organizationId = await resolveOrganizationForLogin(normalizedEmail, sheetDirectoryUser?.active === true);
    let directoryUser = sheetDirectoryUser;

    if (!organizationId || organizationId !== DEFAULT_ORGANIZATION_ID || !directoryUser) {
      const tenantOrganizationId = organizationId;
      const postgresDirectory = tenantOrganizationId && tenantOrganizationId !== DEFAULT_ORGANIZATION_ID
        ? await runWithTenantDatabase(tenantOrganizationId, async () => {
          const user = await findPostgresDirectoryUser(normalizedEmail, tenantOrganizationId);
          return user ? { organizationId: tenantOrganizationId, user } : null;
        })
        : await findPostgresDirectoryUserByEmail(normalizedEmail);
      if (!organizationId && postgresDirectory) {
        organizationId = postgresDirectory.organizationId;
      }
      if (organizationId && organizationId !== DEFAULT_ORGANIZATION_ID) {
        directoryUser = postgresDirectory?.organizationId === organizationId
          ? postgresDirectory.user
          : null;
      } else if (!directoryUser && postgresDirectory?.organizationId === organizationId) {
        directoryUser = postgresDirectory.user;
      }
    }

    if (organizationId && organizationId !== DEFAULT_ORGANIZATION_ID && !directoryUser) {
      // Keep the tenant-specific lookup as a compatibility fallback for
      // deployments where the cross-organization helper cannot be used.
      directoryUser = await runWithTenantDatabase(organizationId, () => findPostgresDirectoryUser(normalizedEmail, organizationId));
    }

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
      canManageCredits: directoryUser?.canManageCredits,
      active: directoryUser?.active,
    });

    if (!organizationId || !directoryUser) {
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

    // Provision the tenant membership and isolated zero-balance account on
    // first successful login. Existing seeded balances are preserved by the
    // conflict-safe account insert.
    await syncOrganizationMembership({ organizationId, email: normalizedEmail, active: true });

    console.log("[Login] Creating session for:", normalizedEmail);

    const token = createSessionToken({
      sub: payload.sub,
      name:
        directoryUser.fullName ||
        payload.name ||
        normalizedEmail,
      email: normalizedEmail,
      organizationId,
      picture: payload.picture,
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
        canManageCredits: directoryUser.canManageCredits,
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
