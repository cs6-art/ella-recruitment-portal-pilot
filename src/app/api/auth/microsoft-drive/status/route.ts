import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canManagePipeline } from "@/lib/access-control";
import { getMicrosoftDriveConnectionStatus, isMicrosoftDriveConfigured } from "@/lib/microsoft-drive";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!canManagePipeline(user) || !isMicrosoftDriveConfigured()) {
    return NextResponse.json({ success: true, configured: isMicrosoftDriveConfigured(), connected: false, accountEmail: "" }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const status = await getMicrosoftDriveConnectionStatus(user.email);
    return NextResponse.json({ success: true, configured: true, ...status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[OneDrive] Status check failed:", error);
    return NextResponse.json({ success: false, error: "Unable to check the OneDrive connection." }, { status: 500 });
  }
}
