import { NextResponse } from "next/server";

import { cookies } from "next/headers";

import { exchangeCodeAndStore, verifyOAuthState } from "@/lib/google-calendar";
import { getFinalInterviewCalendarConfig } from "@/lib/google-sheets";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

function calendarErrorReason(error: unknown, expectedEmail = ""): string {
  const message = error instanceof Error ? error.message : String(error);
  // The shared HR calendar expects the configured "HR calendar account"; a
  // personal calendar expects the signed-in user's own account.
  if (/calendar_account_mismatch|CalendarAccountMismatchError/i.test(message)) return expectedEmail
    ? `The Google account you chose is not the calendar account this portal expects. Choose ${expectedEmail} and connect again.`
    : "The Google account you chose is not the calendar account this portal expects. Choose the correct account and connect again.";
  // Keep provider and storage diagnostics useful to HR without exposing raw
  // OAuth responses, tokens, spreadsheet IDs, or other server details.
  if (/calendar_scope_not_approved/i.test(message)) return "Google did not grant both calendar permissions (availability and interview events). Connect again and approve both.";
  if (/redirect_uri_mismatch/i.test(message)) return "The Google OAuth callback URL is not authorized for this portal domain.";
  if (/invalid_grant|authorization.*expired|code.*expired/i.test(message)) return "The Google authorization expired. Please connect again.";
  if (/access_denied|unauthorized_client|forbidden/i.test(message)) return "Google did not grant this account access to the calendar integration.";
  if (/spreadsheet|sheet|permission|storage/i.test(message)) return "The portal could not save the calendar connection. Check Sheets access and try again.";
  return "Google Calendar authorization failed. Please choose the correct account and try again.";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  // A user connecting their own calendar returns to their profile; the shared
  // HR calendar (an administrator's connection) returns to Settings.
  const sessionUser = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  let settingsUrl = new URL("/settings", url);

  if (oauthError) {
    settingsUrl.searchParams.set("calendar", "denied");
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !state) {
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("calendar_reason", "The Google authorization response was incomplete. Please try again.");
    return NextResponse.redirect(settingsUrl);
  }

  const email = verifyOAuthState(state);
  if (!email) {
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("calendar_reason", "The Google authorization session expired. Please try again.");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const shared = (await getFinalInterviewCalendarConfig()).email.trim().toLowerCase();
    if (sessionUser && sessionUser.email.trim().toLowerCase() === email.trim().toLowerCase() && email.trim().toLowerCase() !== shared) {
      const profileUrl = new URL("/profile", url);
      for (const [key, value] of settingsUrl.searchParams) profileUrl.searchParams.set(key, value);
      settingsUrl = profileUrl;
    }
    await exchangeCodeAndStore(code, email, url.origin);
    settingsUrl.searchParams.set("calendar", "connected");
  } catch (error) {
    console.error("[Google Calendar] Token exchange failed:", error);
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("calendar_reason", calendarErrorReason(error, email));
  }

  return NextResponse.redirect(settingsUrl);
}
