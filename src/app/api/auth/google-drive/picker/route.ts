import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canManagePipeline } from "@/lib/access-control";
import { getDrivePickerAccessToken, getDrivePickerConfig } from "@/lib/google-drive";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

/**
 * The resume picker runs in the HR user's browser, but the Drive refresh token
 * stays encrypted on the server. Return only the short-lived access token and
 * the public Picker settings; never the refresh token.
 */
export async function GET() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401, headers: NO_STORE });
  if (!canManagePipeline(user)) return NextResponse.json({ success: false, error: "Only HR reviewers can import resumes from Google Drive." }, { status: 403, headers: NO_STORE });

  try {
    const config = getDrivePickerConfig();
    const accessToken = await getDrivePickerAccessToken(user.email);
    if (!accessToken) return NextResponse.json({ success: false, error: "Connect Google Drive first.", code: "DRIVE_NOT_CONNECTED" }, { status: 409, headers: NO_STORE });
    return NextResponse.json({ success: true, accessToken, ...config }, { headers: NO_STORE });
  } catch (error) {
    console.error("[Google Drive] Picker setup failed:", error);
    return NextResponse.json({ success: false, error: "Unable to open the Google Drive chooser. Reconnect Google Drive and try again.", code: "DRIVE_RECONNECT_REQUIRED" }, { status: 503, headers: NO_STORE });
  }
}
