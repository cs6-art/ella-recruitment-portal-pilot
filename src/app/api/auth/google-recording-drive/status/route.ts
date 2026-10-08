import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readOAuthConnection } from "@/lib/oauth-connection-store";
import { getOrganizationRecordingDrive } from "@/lib/organization-recording-drive";
import { getRecordingDriveClient, recordingDriveScopesApproved } from "@/lib/recording-drive-oauth";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (user.canEditSettings !== true) return NextResponse.json({ success: false, error: "Settings permission required." }, { status: 403, headers: { "Cache-Control": "no-store" } });

  try {
    const config = await getOrganizationRecordingDrive(user.organizationId);
    const connection = config?.googleAccountEmail
      ? await readOAuthConnection("google_drive_recordings", config.googleAccountEmail, user.organizationId)
      : null;
    // A connection holding outdated Drive permissions is not used; Settings shows a reconnect.
    const reconnectRequired = Boolean(connection?.refreshTokenEnc) && !recordingDriveScopesApproved(connection?.scope || "");
    let connected = false;
    if (connection?.refreshTokenEnc && !reconnectRequired && config?.googleAccountEmail) {
      try {
        // Saved credentials alone do not mean Google still grants access. This
        // checks the access token with Google, refreshing it when necessary.
        connected = Boolean(await getRecordingDriveClient(user.organizationId, config.googleAccountEmail));
      } catch (error) {
        const oauthError = error as {
          message?: string;
          response?: { status?: number; data?: { error?: string } };
        };
        const code = oauthError.response?.data?.error;
        const revoked = code === "invalid_grant" || code === "invalid_token"
          || oauthError.response?.status === 401
          || /invalid_grant|invalid_token|token has been expired or revoked/i.test(oauthError.message || "");
        // Network failures and server errors must not be treated as revoked
        // consent. Keep the saved folder so reconnecting can restore it.
        if (!revoked) throw error;
      }
    }
    return NextResponse.json({
      success: true,
      connected,
      reconnectRequired,
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
