import { NextResponse } from "next/server";

import { driveOAuthErrorReason, exchangeDriveCodeAndStore, verifyOAuthState } from "@/lib/google-drive";

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

  const email = verifyOAuthState(state);
  if (!email) {
    back.searchParams.set("drive", "error");
    back.searchParams.set("drive_reason", "The Google authorization session expired. Please try again.");
    return NextResponse.redirect(back);
  }

  try {
    await exchangeDriveCodeAndStore(code, email, url.origin);
    back.searchParams.set("drive", "connected");
  } catch (error) {
    console.error("[Google Drive] Token exchange failed:", error);
    back.searchParams.set("drive", "error");
    back.searchParams.set("drive_reason", driveOAuthErrorReason(error));
  }
  return NextResponse.redirect(back);
}
