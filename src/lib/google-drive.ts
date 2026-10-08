import { google } from "googleapis";

import { createOAuthState } from "@/lib/google-calendar";
import { deleteDriveConnection, getDriveConnection, saveDriveConnection } from "@/lib/drive-tokens";
import { configureGoogleApiTimeout } from "@/lib/google-api-options";
import { checkGrantedScopes, USER_OAUTH_SCOPES } from "@/lib/google-oauth-scopes";

configureGoogleApiTimeout();

/**
 * Per-HR-user Google Drive connection — a separate OAuth flow from the shared
 * calendar connection. Per-file access: HR grants the non-restricted
 * `drive.file` scope, then chooses resumes in the Google Picker. Google grants
 * the portal access to only those picked files, which it downloads for bulk
 * screening; it can never browse or list the rest of the Drive. Mirrors
 * `google-calendar.ts`; reuses its signed OAuth state.
 */

// drive.file + userinfo.email (the email lets us verify the token belongs to
// the HR user who started the connection). Defined in google-oauth-scopes.ts.
export const DRIVE_SCOPES = USER_OAUTH_SCOPES.resumeDrive;

export class DriveAccountMismatchError extends Error {
  constructor() {
    super("drive_account_mismatch");
    this.name = "DriveAccountMismatchError";
  }
}

export class DriveScopeError extends Error {
  constructor(detail: string) {
    super(`drive_scope_not_approved: ${detail}`);
    this.name = "DriveScopeError";
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
    scope: [...DRIVE_SCOPES],
    // Never fold in permissions granted to this client earlier (such as the
    // retired Drive-wide read scope): the token must carry only DRIVE_SCOPES.
    include_granted_scopes: false,
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
  const scopes = checkGrantedScopes("resumeDrive", tokenInfo.scopes);
  if (!scopes.ok) throw new DriveScopeError([...scopes.missing.map((scope) => `missing ${scope}`), ...scopes.unapproved.map((scope) => `unapproved ${scope}`)].join(", "));
  await saveDriveConnection({
    email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || undefined,
    tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : "",
    scope: tokenInfo.scopes.join(" "),
  });
}

/**
 * A Drive client for this HR user, refreshing (and persisting) the access
 * token first if it is expired or close to it. Returns null when the user has
 * not connected Drive, or the stored token no longer belongs to them.
 */
export async function getAuthorizedDriveClient(email: string) {
  return (await authorizeDrive(email))?.drive ?? null;
}

/** Short-lived access token for the browser-side Google Picker. */
export async function getDrivePickerAccessToken(email: string): Promise<string | null> {
  return (await authorizeDrive(email))?.accessToken ?? null;
}

// Connections made before the move to `drive.file` hold the old broad
// Drive-wide read-only token. They are never used: the stored token is deleted and
// HR reconnects, consenting to drive.file only.
async function discardStaleConnection(email: string, reason: string) {
  console.warn("[Google Drive] Discarding a Drive connection with outdated permissions; HR must reconnect.", { reason });
  await deleteDriveConnection(email);
}

async function authorizeDrive(email: string) {
  const connection = await getDriveConnection(email);
  if (!connection?.refreshToken) return null;
  if (!checkGrantedScopes("resumeDrive", connection.scope).ok) {
    await discardStaleConnection(email, "stored scope");
    return null;
  }

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
  // Google's own view of the live token is authoritative over the stored string.
  if (!checkGrantedScopes("resumeDrive", tokenInfo.scopes).ok) {
    await discardStaleConnection(email, "live token scope");
    return null;
  }
  if (refreshed) {
    await saveDriveConnection({
      email,
      accessToken: refreshed.access_token || "",
      tokenExpiresAt: refreshed.expiry_date ? new Date(refreshed.expiry_date).toISOString() : "",
      scope: tokenInfo.scopes.join(" "),
    });
  }
  return { drive: google.drive({ version: "v3", auth: client }), accessToken };
}

export function getDrivePickerConfig() {
  const apiKey = process.env.GOOGLE_PICKER_API_KEY?.trim();
  const projectNumber = process.env.GOOGLE_CLOUD_PROJECT_NUMBER?.trim();
  if (!apiKey || !projectNumber) throw new Error("Google Picker is not configured.");
  return { apiKey, projectNumber };
}

export async function getDriveConnectionStatus(email: string): Promise<{ connected: boolean; reconnectRequired: boolean; accountEmail: string; connectedAt: string }> {
  const connection = await getDriveConnection(email);
  if (!connection?.refreshToken) return { connected: false, reconnectRequired: false, accountEmail: "", connectedAt: "" };
  if (!checkGrantedScopes("resumeDrive", connection.scope).ok) {
    await discardStaleConnection(email, "stored scope");
    return { connected: false, reconnectRequired: true, accountEmail: "", connectedAt: "" };
  }
  return { connected: true, reconnectRequired: false, accountEmail: connection.email, connectedAt: connection.connectedAt };
}

export async function disconnectDrive(email: string): Promise<void> {
  await deleteDriveConnection(email);
}

export function driveOAuthErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/drive_account_mismatch|DriveAccountMismatchError/i.test(message)) return "The Google account selected is not the one you signed in with. Choose your own account and connect again.";
  if (/drive_scope_not_approved/i.test(message)) return "Google returned different Drive permissions than the portal asks for. Remove the portal under your Google Account's third-party access, then connect again.";
  if (/redirect_uri_mismatch/i.test(message)) return "The Google OAuth callback URL is not authorized for this portal domain.";
  if (/invalid_grant|authorization.*expired|code.*expired/i.test(message)) return "The Google authorization expired. Please connect again.";
  if (/access_denied|unauthorized_client|forbidden|insufficient/i.test(message)) return "Google did not grant Drive access for this account.";
  if (/spreadsheet|sheet|permission|storage/i.test(message)) return "The portal could not save the Drive connection. Try again.";
  return "Google Drive authorization failed. Please choose the correct account and try again.";
}
