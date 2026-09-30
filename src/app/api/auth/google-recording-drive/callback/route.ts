import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getOrganizationRecordingDrive, saveOrganizationRecordingDrive } from "@/lib/organization-recording-drive";
import { deleteRecordingDriveConnectionIfUnused, exchangeRecordingDriveCode, verifyRecordingDriveOAuthState } from "@/lib/recording-drive-oauth";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

function settingsRedirect(requestUrl: URL, status: "connected" | "denied" | "error", reason = "") {
  const target = new URL("/settings", requestUrl);
  target.searchParams.set("recording-drive", status);
  if (reason) target.searchParams.set("recording-drive-reason", reason);
  return NextResponse.redirect(target);
}

function userSafeReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/redirect_uri_mismatch/i.test(message)) return "The Google OAuth callback URL is not authorized for this portal domain.";
  if (/invalid_grant|authorization.*expired|code.*expired/i.test(message)) return "Google authorization expired. Please connect again.";
  if (/access_denied|unauthorized_client|forbidden|insufficient/i.test(message)) return "Google did not grant the required Drive permission.";
  if (/long-lived Drive authorization/i.test(message)) return "Google did not provide ongoing access. Please try connecting again and approve the Drive permission.";
  return "Google Drive could not be connected. Check the setup and try again.";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams;
  const state = query.get("state") || "";
  const code = query.get("code") || "";
  const oauthError = query.get("error");
  const payload = verifyRecordingDriveOAuthState(state);
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);

  if (!payload || !user || user.organizationId !== payload.organizationId || user.email.trim().toLowerCase() !== payload.actorEmail || user.canEditSettings !== true) {
    return settingsRedirect(url, "error", "Your settings session expired. Sign in again and reconnect Google Drive.");
  }
  if (oauthError) return settingsRedirect(url, "denied", "Google Drive connection was cancelled.");
  if (!code) return settingsRedirect(url, "error", "The Google authorization response was incomplete. Please try again.");

  try {
    const previous = await getOrganizationRecordingDrive(user.organizationId);
    const accountEmail = await exchangeRecordingDriveCode(code, user.organizationId, url.origin);
    await saveOrganizationRecordingDrive({
      organizationId: user.organizationId,
      googleAccountEmail: accountEmail,
      connectedByEmail: user.email,
      updatedByEmail: user.email,
    });
    if (previous?.googleAccountEmail && previous.googleAccountEmail !== accountEmail) {
      await deleteRecordingDriveConnectionIfUnused(user.organizationId, previous.googleAccountEmail);
    }
    return settingsRedirect(url, "connected");
  } catch (error) {
    console.error("[Recording Drive OAuth] Token exchange failed:", error);
    return settingsRedirect(url, "error", userSafeReason(error));
  }
}
