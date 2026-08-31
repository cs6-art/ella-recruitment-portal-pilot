import { createOAuthState } from "@/lib/google-calendar";
import { deleteMicrosoftDriveConnection, getMicrosoftDriveConnection, saveMicrosoftDriveConnection } from "@/lib/microsoft-drive-tokens";

/**
 * Per-HR-user Microsoft OneDrive connection — a wholly separate OAuth flow
 * from any Google credential. Read-only: HR grants `Files.Read` so the portal
 * can browse their OneDrive and download the resume files they pick for bulk
 * screening. Raw OAuth2 auth-code flow against the Microsoft identity
 * platform; reuses the generic signed OAuth state from `google-calendar.ts`.
 */

// Delegated, least-privilege: read the signed-in user's own files, keep a
// refresh token, and identify the account.
export const MS_DRIVE_SCOPES = ["Files.Read", "User.Read", "offline_access", "openid", "profile", "email"];
const GRAPH = "https://graph.microsoft.com/v1.0";

export { verifyOAuthState } from "@/lib/google-calendar";

export class MicrosoftDriveAccountMismatchError extends Error {
  constructor() {
    super("microsoft_drive_account_mismatch");
    this.name = "MicrosoftDriveAccountMismatchError";
  }
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function tenant(): string {
  return (process.env.MS_TENANT_ID || "organizations").trim();
}

function authorityBase(): string {
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0`;
}

function oauthConfig(requestOrigin?: string) {
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  const appOrigin = requestOrigin || process.env.NEXT_PUBLIC_APP_URL || "";
  const redirectUri = appOrigin
    ? new URL("/api/auth/microsoft-drive/callback", appOrigin).toString()
    : process.env.MS_DRIVE_OAUTH_REDIRECT_URI;
  if (!clientId) throw new Error("MS_CLIENT_ID is not configured.");
  if (!clientSecret) throw new Error("MS_CLIENT_SECRET is not configured.");
  if (!redirectUri) throw new Error("A Microsoft OneDrive OAuth redirect URI is not configured.");
  return { clientId, clientSecret, redirectUri };
}

export function isMicrosoftDriveConfigured(): boolean {
  return Boolean(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

export function getMicrosoftConsentUrl(email: string, requestOrigin?: string): string {
  const { clientId, redirectUri } = oauthConfig(requestOrigin);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: MS_DRIVE_SCOPES.join(" "),
    state: createOAuthState(email),
    login_hint: email,
    prompt: "select_account",
  });
  return `${authorityBase()}/authorize?${params}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function requestToken(body: Record<string, string>, requestOrigin?: string): Promise<TokenResponse> {
  const { clientId, clientSecret, redirectUri } = oauthConfig(requestOrigin);
  const response = await fetch(`${authorityBase()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, ...body }),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Microsoft token request failed (HTTP ${response.status}).`);
  }
  return data;
}

async function graphMe(accessToken: string): Promise<string> {
  const response = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) return "";
  const data = (await response.json().catch(() => ({}))) as { mail?: string; userPrincipalName?: string };
  return normalizedEmail(data.mail || data.userPrincipalName || "");
}

export async function exchangeMicrosoftCodeAndStore(code: string, email: string, requestOrigin?: string): Promise<void> {
  const tokens = await requestToken({ grant_type: "authorization_code", code }, requestOrigin);
  const account = await graphMe(tokens.access_token!);
  if (!account || account !== normalizedEmail(email)) throw new MicrosoftDriveAccountMismatchError();
  await saveMicrosoftDriveConnection({
    email,
    accessToken: tokens.access_token!,
    refreshToken: tokens.refresh_token || undefined,
    tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : "",
    scope: tokens.scope || MS_DRIVE_SCOPES.join(" "),
  });
}

/**
 * A valid Microsoft Graph access token for this HR user, refreshing (and
 * persisting) it first if expired or close to it. Returns null when the user
 * has not connected OneDrive, or the refresh token is no longer valid
 * (revoked access) — the caller then asks HR to reconnect.
 */
export async function getAuthorizedGraphToken(email: string): Promise<string | null> {
  const connection = await getMicrosoftDriveConnection(email);
  if (!connection?.refreshToken) return null;

  const expiresAt = connection.tokenExpiresAt ? Date.parse(connection.tokenExpiresAt) : 0;
  if (connection.accessToken && expiresAt && expiresAt > Date.now() + 120_000) {
    return connection.accessToken;
  }

  try {
    const tokens = await requestToken({
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
      scope: MS_DRIVE_SCOPES.join(" "),
    });
    await saveMicrosoftDriveConnection({
      email,
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token || connection.refreshToken,
      tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : "",
      scope: tokens.scope || connection.scope,
    });
    return tokens.access_token!;
  } catch (error) {
    // invalid_grant / consent revoked / password changed — the stored token is dead.
    console.warn("[OneDrive] Refresh failed; HR must reconnect:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function getMicrosoftDriveConnectionStatus(email: string): Promise<{ connected: boolean; accountEmail: string; connectedAt: string }> {
  const connection = await getMicrosoftDriveConnection(email);
  if (!connection?.refreshToken) return { connected: false, accountEmail: "", connectedAt: "" };
  return { connected: true, accountEmail: connection.email, connectedAt: connection.connectedAt };
}

export async function disconnectMicrosoftDrive(email: string): Promise<void> {
  await deleteMicrosoftDriveConnection(email);
}

export function microsoftOAuthErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/microsoft_drive_account_mismatch/i.test(message)) return "The Microsoft account you signed in with is not the one you use in the portal. Choose the correct account and connect again.";
  if (/redirect_uri|reply url/i.test(message)) return "The Microsoft OAuth redirect URL is not registered for this portal domain.";
  if (/invalid_grant|expired|AADSTS70008|AADSTS700082/i.test(message)) return "The Microsoft authorization expired. Please connect again.";
  if (/consent|AADSTS65001|AADSTS90008|access_denied/i.test(message)) return "Microsoft did not grant OneDrive access for this account. An administrator may need to approve the permission.";
  if (/AADSTS9002313|invalid_request/i.test(message)) return "The Microsoft authorization request was rejected. Check the app registration.";
  if (/spreadsheet|sheet|permission|storage/i.test(message)) return "The portal could not save the OneDrive connection. Try again.";
  return "Microsoft OneDrive authorization failed. Please choose the correct account and try again.";
}

// --- Microsoft Graph (OneDrive) file operations ------------------------------

export type GraphItem = {
  id: string;
  name: string;
  size: number;
  isFolder: boolean;
  mimeType: string;
  lastModified: string;
  parentId: string | null;
  downloadUrl?: string;
};

function toItem(raw: Record<string, unknown>): GraphItem {
  const file = raw.file as { mimeType?: string } | undefined;
  const parentReference = raw.parentReference as { id?: string } | undefined;
  return {
    id: String(raw.id || ""),
    name: String(raw.name || "Untitled"),
    size: Number(raw.size || 0),
    isFolder: Boolean(raw.folder),
    mimeType: file?.mimeType || "",
    lastModified: String(raw.lastModifiedDateTime || ""),
    parentId: parentReference?.id ?? null,
    downloadUrl: typeof raw["@microsoft.graph.downloadUrl"] === "string" ? (raw["@microsoft.graph.downloadUrl"] as string) : undefined,
  };
}

async function graphGet(token: string, path: string): Promise<Record<string, unknown>> {
  const response = await fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Graph ${response.status}: ${detail.slice(0, 300)}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

export async function listMicrosoftDriveChildren(
  token: string,
  folderId: string,
  pageUrl?: string,
): Promise<{ items: GraphItem[]; nextPageUrl: string | null; folder: GraphItem | null }> {
  const base = folderId === "root" ? "/me/drive/root/children" : `/me/drive/items/${encodeURIComponent(folderId)}/children`;
  const query = "$select=id,name,size,folder,file,lastModifiedDateTime,parentReference&$top=200&$orderby=name";
  const data = await graphGet(token, pageUrl || `${base}?${query}`);
  const items = Array.isArray(data.value) ? (data.value as Array<Record<string, unknown>>).map(toItem) : [];
  const folder = folderId === "root" ? null : toItem(await graphGet(token, `/me/drive/items/${encodeURIComponent(folderId)}?$select=id,name,parentReference`));
  return { items, nextPageUrl: typeof data["@odata.nextLink"] === "string" ? (data["@odata.nextLink"] as string) : null, folder };
}

export async function getMicrosoftDriveItem(token: string, itemId: string): Promise<GraphItem> {
  return toItem(await graphGet(token, `/me/drive/items/${encodeURIComponent(itemId)}?$select=id,name,size,folder,file,parentReference`));
}

export async function downloadMicrosoftDriveFile(token: string, itemId: string): Promise<Buffer> {
  // Prefer the pre-authenticated download URL (avoids re-auth on the storage
  // redirect); fall back to the /content endpoint.
  const meta = await graphGet(token, `/me/drive/items/${encodeURIComponent(itemId)}?$select=id,name,@microsoft.graph.downloadUrl`);
  const downloadUrl = typeof meta["@microsoft.graph.downloadUrl"] === "string" ? (meta["@microsoft.graph.downloadUrl"] as string) : "";
  const response = downloadUrl
    ? await fetch(downloadUrl, { cache: "no-store" })
    : await fetch(`${GRAPH}/me/drive/items/${encodeURIComponent(itemId)}/content`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "follow" });
  if (!response.ok) throw new Error(`Unable to download the file from OneDrive (HTTP ${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}
