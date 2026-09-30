import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getOrganizationRecordingDrive } from "@/lib/organization-recording-drive";
import { getRecordingDriveClient } from "@/lib/recording-drive-oauth";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The folder picker runs in the authenticated HR user's browser, but the
 * connected Drive refresh token stays encrypted on the server. Return only
 * the short-lived access token that Google Picker needs; never return the
 * refresh token or the encrypted token fields.
 */
export async function GET() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (user.canEditSettings !== true) return NextResponse.json({ success: false, error: "Settings permission required." }, { status: 403, headers: { "Cache-Control": "no-store" } });

  try {
    const config = await getOrganizationRecordingDrive(user.organizationId);
    if (!config?.googleAccountEmail) return NextResponse.json({ success: false, error: "Connect Google Drive before choosing a folder." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    const authorized = await getRecordingDriveClient(user.organizationId, config.googleAccountEmail);
    if (!authorized?.accessToken) return NextResponse.json({ success: false, error: "Reconnect this organization's Google Drive account before choosing a folder." }, { status: 409, headers: { "Cache-Control": "no-store" } });

    return NextResponse.json({ success: true, accessToken: authorized.accessToken }, {
      headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" },
    });
  } catch (error) {
    console.error("[Recording Drive] Picker token request failed:", error);
    return NextResponse.json({ success: false, error: "Unable to authorize Google Drive folder selection. Reconnect the account and try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
