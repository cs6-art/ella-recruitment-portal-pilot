import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readOAuthConnection } from "@/lib/oauth-connection-store";
import { getOrganizationRecordingDrive } from "@/lib/organization-recording-drive";
import { getRecordingDrivePickerConfig } from "@/lib/recording-drive-oauth";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (user.canEditSettings !== true) return NextResponse.json({ success: false, error: "Settings permission required." }, { status: 403, headers: { "Cache-Control": "no-store" } });

  try {
    const config = await getOrganizationRecordingDrive(user.organizationId);
    if (!config?.googleAccountEmail) return NextResponse.json({ success: false, error: "Connect Google Drive before choosing a folder." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    const connection = await readOAuthConnection("google_drive_recordings", config.googleAccountEmail, user.organizationId);
    if (!connection?.refreshTokenEnc) return NextResponse.json({ success: false, error: "Reconnect this organization's Google Drive account before choosing a folder." }, { status: 409, headers: { "Cache-Control": "no-store" } });

    // These are public web-client values; OAuth access and refresh tokens never
    // leave the server through this configuration response.
    return NextResponse.json({ success: true, ...getRecordingDrivePickerConfig() }, {
      headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" },
    });
  } catch (error) {
    console.error("[Recording Drive] Picker configuration request failed:", error);
    return NextResponse.json({ success: false, error: "Unable to prepare Google Drive folder selection. Check the connection or contact your administrator." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
