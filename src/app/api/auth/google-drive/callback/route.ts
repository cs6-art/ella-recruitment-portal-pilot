import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { completeDriveOAuthConnection } from "@/lib/drive-oauth-flow";
import { driveOAuthErrorReason, exchangeDriveCodeAndStore, getDriveConnectionStatus } from "@/lib/google-drive";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  // The Drive connection lives on the Resume Screening page.
  const back = new URL("/resume-screening", url);

  if (oauthError) {
    back.searchParams.set("drive", "denied");
    return NextResponse.redirect(back);
  }
  if (!code || !state) {
    back.searchParams.set("drive", "error");
    back.searchParams.set("drive_reason", "The Google authorization response was incomplete. Please try again.");
    return NextResponse.redirect(back);
  }

  try {
    const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
    const connected = await completeDriveOAuthConnection(
      state, user,
      (email) => exchangeDriveCodeAndStore(code, email, url.origin),
      getDriveConnectionStatus,
    );
    back.searchParams.set("drive", connected ? "connected" : "error");
    if (!connected) back.searchParams.set("drive_reason", "This Drive connection attempt expired or belongs to another signed-in account or organization. Start a new connection.");
  } catch (error) {
    console.error("[Google Drive] Token exchange failed:", error);
    back.searchParams.set("drive", "error");
    back.searchParams.set("drive_reason", driveOAuthErrorReason(error));
  }
  return NextResponse.redirect(back);
}
