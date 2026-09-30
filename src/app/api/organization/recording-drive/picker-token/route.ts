import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getOrganizationRecordingDrive } from "@/lib/organization-recording-drive";
import { getRecordingDrivePickerAccess } from "@/lib/recording-drive-oauth";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (user.canEditSettings !== true) return NextResponse.json({ success: false, error: "Settings permission required." }, { status: 403, headers: { "Cache-Control": "no-store" } });

  try {
    const config = await getOrganizationRecordingDrive(user.organizationId);
    if (!config?.googleAccountEmail) return NextResponse.json({ success: false, error: "Connect Google Drive before choosing a folder." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    const access = await getRecordingDrivePickerAccess(user.organizationId, config.googleAccountEmail);
    return NextResponse.json({ success: true, ...access }, {
      headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" },
    });
  } catch (error) {
    console.error("[Recording Drive] Picker token request failed:", error);
    return NextResponse.json({ success: false, error: "Unable to open Google Drive. Reconnect the account or contact your administrator." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
