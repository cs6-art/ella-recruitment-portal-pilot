import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canManagePipeline } from "@/lib/access-control";
import { getDriveConnectionStatus } from "@/lib/google-drive";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!canManagePipeline(user)) return NextResponse.json({ success: true, connected: false, accountEmail: "" }, { headers: { "Cache-Control": "no-store" } });

  try {
    const status = await getDriveConnectionStatus(user.email);
    return NextResponse.json({ success: true, ...status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[Google Drive] Status check failed:", error);
    return NextResponse.json({ success: false, error: "Unable to check the Google Drive connection." }, { status: 500 });
  }
}
