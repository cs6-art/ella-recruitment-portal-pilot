import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canManagePipeline } from "@/lib/access-control";
import { verifyDriveOAuthState } from "@/lib/drive-oauth-state";
import { driveOAuthErrorReason, exchangeDriveCodeAndStore } from "@/lib/google-drive";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";
import { runWithTenantDatabase } from "@/lib/tenant-database";

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

  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  const payload = user && canManagePipeline(user) ? verifyDriveOAuthState(state, user) : null;
  if (!payload) {
    back.searchParams.set("drive", "error");
    back.searchParams.set("drive_reason", "The Google authorization session expired or your signed-in organization changed. Please connect again.");
    return NextResponse.redirect(back);
  }

  try {
    // The callback is a new request: explicitly restore the initiating tenant.
    await runWithTenantDatabase(payload.organizationId, () => exchangeDriveCodeAndStore(code, payload.email, url.origin));
    back.searchParams.set("drive", "connected");
  } catch (error) {
    console.error("[Google Drive] Token exchange failed:", error);
    back.searchParams.set("drive", "error");
    back.searchParams.set("drive_reason", driveOAuthErrorReason(error));
  }
  return NextResponse.redirect(back);
}
