import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readOAuthConnection } from "@/lib/oauth-connection-store";
import { getOrganizationRecordingDrive } from "@/lib/organization-recording-drive";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (user.canEditSettings !== true) return NextResponse.json({ success: false, error: "Settings permission required." }, { status: 403, headers: { "Cache-Control": "no-store" } });

  try {
    const config = await getOrganizationRecordingDrive(user.organizationId);
    const connection = config?.googleAccountEmail
      ? await readOAuthConnection("google_drive_recordings", config.googleAccountEmail, user.organizationId)
      : null;
    const connected = Boolean(connection?.refreshTokenEnc);
    return NextResponse.json({
      success: true,
      connected,
      accountEmail: connected ? config?.googleAccountEmail || "" : "",
      folderConfigured: connected && Boolean(config?.folderId),
      folderName: connected ? config?.folderName || "" : "",
      connectedByEmail: connected ? config?.connectedByEmail || "" : "",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[Recording Drive] Status check failed:", error);
    return NextResponse.json({ success: false, error: "Unable to check the organization's recording storage." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
