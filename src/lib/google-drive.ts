import { google } from "googleapis";

import { createOAuthState } from "@/lib/google-calendar";
import { deleteDriveConnection, getDriveConnection, saveDriveConnection } from "@/lib/drive-tokens";

/**
 * Per-HR-user Google Drive connection — a separate OAuth flow from the shared
 * calendar connection. Read-only: HR grants `drive.readonly` so the portal can
 * browse their Drive and download the resume files they pick for bulk
 * screening. Mirrors `google-calendar.ts`; reuses its signed OAuth state.
 */

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  // So token introspection returns the account email — lets us verify the
  // token belongs to the HR user who started the connection.
  "https://www.googleapis.com/auth/userinfo.email",
];

export class DriveAccountMismatchError extends Error {
  constructor() {
    super("drive_account_mismatch");
    this.name = "DriveAccountMismatchError";
  }
}

export { verifyOAuthState } from "@/lib/google-calendar";

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function oauthConfig(requestOrigin?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const appOrigin = requestOrigin || process.env.NEXT_PUBLIC_APP_URL || "";
  const redirectUri = appOrigin
    ? new URL("/api/auth/google-drive/callback", appOrigin).toString()
    : (process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI || process.env.GOOGLE_OAUTH_REDIRECT_URI);
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not configured.");
  if (!clientSecret) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET is not configured.");
  if (!redirectUri) throw new Error("A Google Drive OAuth redirect URI is not configured.");
  return { clientId, clientSecret, redirectUri };
}

function newOAuthClient(requestOrigin?: string) {
  const { clientId, clientSecret, redirectUri } = oauthConfig(requestOrigin);
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getDriveConsentUrl(email: string, requestOrigin?: string): string {
  return newOAuthClient(requestOrigin).generateAuthUrl({
    access_type: "offline",
    prompt: "select_account consent",
    scope: DRIVE_SCOPES,
    state: createOAuthState(email),
    login_hint: email,
  });
}

export async function exchangeDriveCodeAndStore(code: string, email: string, requestOrigin?: string): Promise<void> {
  const client = newOAuthClient(requestOrigin);
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) throw new Error("Google did not return an access token.");
  const tokenInfo = await client.getTokenInfo(tokens.access_token);
  const authorizedEmail = normalizedEmail(tokenInfo.email || "");
  if (!authorizedEmail || authorizedEmail !== normalizedEmail(email)) throw new DriveAccountMismatchError();
  await saveDriveConnection({
    email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || undefined,
    tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : "",
    scope: tokens.scope || DRIVE_SCOPES.join(" "),
  });
}

/**
 * A Drive client for this HR user, refreshing (and persisting) the access
 * token first if it is expired or close to it. Returns null when the user has
 * not connected Drive, or the stored token no longer belongs to them.
 */
export async function getAuthorizedDriveClient(email: string) {
  const connection = await getDriveConnection(email);
  if (!connection?.refreshToken) return null;

  const client = newOAuthClient();
  const expiresAt = connection.tokenExpiresAt ? Date.parse(connection.tokenExpiresAt) : 0;
  const needsRefresh = !connection.accessToken || !expiresAt || expiresAt < Date.now() + 60_000;
  let refreshed: { access_token?: string | null; expiry_date?: number | null; scope?: string | null } | null = null;

  if (needsRefresh) {
    client.setCredentials({ refresh_token: connection.refreshToken });
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    refreshed = credentials;
  } else {
    client.setCredentials({ access_token: connection.accessToken, refresh_token: connection.refreshToken });
  }

  const accessToken = client.credentials.access_token;
  if (!accessToken) return null;
  const tokenInfo = await client.getTokenInfo(accessToken);
  if (normalizedEmail(tokenInfo.email || "") !== normalizedEmail(email)) {
    console.warn("[Google Drive] Stored OAuth token no longer belongs to the connecting HR user.");
    return null;
  }
  if (refreshed) {
    await saveDriveConnection({
      email,
      accessToken: refreshed.access_token || "",
      tokenExpiresAt: refreshed.expiry_date ? new Date(refreshed.expiry_date).toISOString() : "",
      scope: refreshed.scope || DRIVE_SCOPES.join(" "),
    });
  }
  return google.drive({ version: "v3", auth: client });
}

export async function getDriveConnectionStatus(email: string): Promise<{ connected: boolean; accountEmail: string; connectedAt: string }> {
  const connection = await getDriveConnection(email);
  if (!connection?.refreshToken) return { connected: false, accountEmail: "", connectedAt: "" };
  return { connected: true, accountEmail: connection.email, connectedAt: connection.connectedAt };
}

export async function disconnectDrive(email: string): Promise<void> {
  await deleteDriveConnection(email);
}

export function driveOAuthErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/drive_account_mismatch|DriveAccountMismatchError/i.test(message)) return "The Google account selected is not the one you signed in with. Choose your own account and connect again.";
  if (/redirect_uri_mismatch/i.test(message)) return "The Google OAuth callback URL is not authorized for this portal domain.";
  if (/invalid_grant|authorization.*expired|code.*expired/i.test(message)) return "The Google authorization expired. Please connect again.";
  if (/access_denied|unauthorized_client|forbidden|insufficient/i.test(message)) return "Google did not grant Drive access for this account.";
  if (/spreadsheet|sheet|permission|storage/i.test(message)) return "The portal could not save the Drive connection. Try again.";
  return "Google Drive authorization failed. Please choose the correct account and try again.";
}
