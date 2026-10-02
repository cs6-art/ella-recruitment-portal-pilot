import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getOrganizationReadiness } from "@/lib/organization-readiness";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Return only setup statuses for the organization already bound to this session. */
export async function GET() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Please sign in to view workspace setup." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const readiness = await getOrganizationReadiness(user.organizationId);
    if (!readiness) return NextResponse.json({ success: false, error: "We could not find this workspace." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    // Keep the owner address for platform admins, not the general dashboard payload;
    // users only need the owner's registration status.
    const { ownerEmail: _ownerEmail, ...publicReadiness } = readiness;
    return NextResponse.json({ success: true, readiness: publicReadiness }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Organization Readiness] GET failed:", error);
    return NextResponse.json({ success: false, error: "We could not check workspace setup. Please try again." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
