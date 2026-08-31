import { NextResponse } from "next/server";

import { exchangeMicrosoftCodeAndStore, microsoftOAuthErrorReason, verifyOAuthState } from "@/lib/microsoft-drive";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const oauthErrorDescription = url.searchParams.get("error_description");

  const back = new URL("/resume-screening", url);

  if (oauthError) {
    back.searchParams.set("onedrive", "denied");
    if (oauthErrorDescription) back.searchParams.set("onedrive_reason", microsoftOAuthErrorReason(oauthErrorDescription));
    return NextResponse.redirect(back);
  }
  if (!code || !state) {
    back.searchParams.set("onedrive", "error");
    back.searchParams.set("onedrive_reason", "The Microsoft authorization response was incomplete. Please try again.");
    return NextResponse.redirect(back);
  }

  const email = verifyOAuthState(state);
  if (!email) {
    back.searchParams.set("onedrive", "error");
    back.searchParams.set("onedrive_reason", "The Microsoft authorization session expired. Please try again.");
    return NextResponse.redirect(back);
  }

  try {
    await exchangeMicrosoftCodeAndStore(code, email, url.origin);
    back.searchParams.set("onedrive", "connected");
  } catch (error) {
    console.error("[OneDrive] Token exchange failed:", error);
    back.searchParams.set("onedrive", "error");
    back.searchParams.set("onedrive_reason", microsoftOAuthErrorReason(error));
  }
  return NextResponse.redirect(back);
}
