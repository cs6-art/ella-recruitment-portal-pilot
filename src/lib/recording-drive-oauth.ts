import crypto from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import { google } from "googleapis";

import { getDb } from "@/db/client";
import { liveInterviewSessions } from "@/db/schema-recruitment";
import { deleteOAuthConnection, readOAuthConnection, saveOAuthConnection } from "@/lib/oauth-connection-store";
import { getOrganizationRecordingDrive } from "@/lib/organization-recording-drive";

const PROVIDER = "google_drive_recordings" as const;
export const RECORDING_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];

type RecordingDriveState = { organizationId: string; actorEmail: string; exp: number };

export type RecordingDriveFolder = { id: string; name: string; driveId: string };

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function oauthClient(requestOrigin?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const origin = requestOrigin || process.env.NEXT_PUBLIC_APP_URL || "";
  const redirectUri = origin
    ? new URL("/api/auth/google-recording-drive/callback", origin).toString()
    : process.env.GOOGLE_RECORDING_DRIVE_OAUTH_REDIRECT_URI;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not configured.");
  if (!clientSecret) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET is not configured.");
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri || undefined);
}

function encryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return crypto.scryptSync(secret, "recording-drive-token-encryption", 32);
}

function encrypt(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

function decrypt(value: string) {
  try {
    const bytes = Buffer.from(value, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export function createRecordingDriveOAuthState(organizationId: string, actorEmail: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  const payload: RecordingDriveState = {
    organizationId: organizationId.trim(),
    actorEmail: normalizedEmail(actorEmail),
    exp: Math.floor(Date.now() / 1000) + 600,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyRecordingDriveOAuthState(state: string): RecordingDriveState | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  const suppliedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(suppliedBytes, expectedBytes)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as RecordingDriveState;
    if (!payload.organizationId || !payload.actorEmail || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { ...payload, actorEmail: normalizedEmail(payload.actorEmail) };
  } catch {
    return null;
  }
}

export function getRecordingDriveConsentUrl(organizationId: string, actorEmail: string, requestOrigin: string) {
  return oauthClient(requestOrigin).generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "select_account consent",
    scope: RECORDING_DRIVE_SCOPES,
    state: createRecordingDriveOAuthState(organizationId, actorEmail),
  });
}

export async function exchangeRecordingDriveCode(code: string, organizationId: string, requestOrigin: string) {
  const client = oauthClient(requestOrigin);
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) throw new Error("Google did not return an access token.");
  const tokenInfo = await client.getTokenInfo(tokens.access_token);
  const accountEmail = normalizedEmail(tokenInfo.email || "");
  if (!accountEmail) throw new Error("Google did not identify the connected Drive account.");
  const scope = tokens.scope || "";
  if (!scope.split(/\s+/).includes("https://www.googleapis.com/auth/drive.file")) {
    throw new Error("Google Drive file access was not granted.");
  }
  const existing = await readOAuthConnection(PROVIDER, accountEmail, organizationId);
  const refreshToken = tokens.refresh_token || (existing ? decrypt(existing.refreshTokenEnc) : "");
  if (!refreshToken) throw new Error("Google did not issue a long-lived Drive authorization. Please try connecting again.");
  await saveOAuthConnection(PROVIDER, accountEmail, {
    accessTokenEnc: encrypt(tokens.access_token),
    refreshTokenEnc: encrypt(refreshToken),
    tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    scope,
    accountEmail,
    connectedAt: existing?.connectedAt,
  }, organizationId);
  return accountEmail;
}

/** Retrieves this organization's Drive account and refreshes its encrypted token when necessary. */
export async function getRecordingDriveClient(organizationId: string, accountEmail: string) {
  const email = normalizedEmail(accountEmail);
  const connection = await readOAuthConnection(PROVIDER, email, organizationId);
  if (!connection?.refreshTokenEnc) return null;
  const refreshToken = decrypt(connection.refreshTokenEnc);
  if (!refreshToken) return null;

  const client = oauthClient();
  const expiry = connection.tokenExpiresAt?.getTime() || 0;
  const refreshed = !connection.accessTokenEnc || expiry < Date.now() + 60_000;
  if (refreshed) {
    client.setCredentials({ refresh_token: refreshToken });
    const response = await client.refreshAccessToken();
    client.setCredentials(response.credentials);
    const accessToken = response.credentials.access_token || "";
    if (!accessToken) throw new Error("Google did not refresh the Drive connection.");
    const tokenInfo = await client.getTokenInfo(accessToken);
    if (normalizedEmail(tokenInfo.email || "") !== email) throw new Error("The saved Google Drive connection belongs to a different account.");
    await saveOAuthConnection(PROVIDER, email, {
      accessTokenEnc: encrypt(accessToken),
      refreshTokenEnc: encrypt(response.credentials.refresh_token || refreshToken),
      tokenExpiresAt: response.credentials.expiry_date ? new Date(response.credentials.expiry_date).toISOString() : null,
      scope: response.credentials.scope || connection.scope,
      accountEmail: email,
      connectedAt: connection.connectedAt,
    }, organizationId);
  } else {
    client.setCredentials({ access_token: decrypt(connection.accessTokenEnc), refresh_token: refreshToken });
    const tokenInfo = await client.getTokenInfo(client.credentials.access_token || "");
    if (normalizedEmail(tokenInfo.email || "") !== email) throw new Error("The saved Google Drive connection belongs to a different account.");
  }
  const accessToken = client.credentials.access_token;
  if (!accessToken) return null;
  return { drive: google.drive({ version: "v3", auth: client }), accessToken };
}

export async function getRecordingDrivePickerAccess(organizationId: string, accountEmail: string) {
  const apiKey = process.env.GOOGLE_PICKER_API_KEY?.trim();
  const projectNumber = process.env.GOOGLE_CLOUD_PROJECT_NUMBER?.trim();
  if (!apiKey || !projectNumber) throw new Error("Google Picker is not configured.");
  const authorized = await getRecordingDriveClient(organizationId, accountEmail);
  if (!authorized) throw new Error("Connect the organization's Google Drive account first.");
  return { accessToken: authorized.accessToken, apiKey, projectNumber };
}

export async function validateRecordingDriveFolder(organizationId: string, accountEmail: string, folderId: string): Promise<RecordingDriveFolder> {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(folderId)) throw new Error("Choose a valid Google Drive folder.");
  const authorized = await getRecordingDriveClient(organizationId, accountEmail);
  if (!authorized) throw new Error("Connect the organization's Google Drive account first.");
  const { data } = await authorized.drive.files.get({
    fileId: folderId,
    fields: "id,name,mimeType,driveId,capabilities(canAddChildren)",
    supportsAllDrives: true,
  });
  if (data.mimeType !== "application/vnd.google-apps.folder") throw new Error("Choose a folder, not a file.");
  if (data.capabilities?.canAddChildren !== true) throw new Error("That account cannot save recordings in this folder. Choose a folder where it can add files.");
  return { id: data.id || folderId, name: data.name || "Google Drive folder", driveId: data.driveId || "" };
}

/** Keep old account authorization only while this org still has recordings using it. */
export async function deleteRecordingDriveConnectionIfUnused(organizationId: string, accountEmail: string) {
  const email = normalizedEmail(accountEmail);
  if (!email) return;
  const active = await getOrganizationRecordingDrive(organizationId);
  if (normalizedEmail(active?.googleAccountEmail || "") === email) return;
  const [recording] = await getDb().select({ id: liveInterviewSessions.id }).from(liveInterviewSessions).where(and(
    eq(liveInterviewSessions.organizationId, organizationId),
    eq(liveInterviewSessions.recordingStorageAccountEmail, email),
    or(sql`${liveInterviewSessions.recordingStorageRef} <> ''`, sql`${liveInterviewSessions.recordingUploadUrl} <> ''`),
  )).limit(1);
  if (!recording) await deleteOAuthConnection(PROVIDER, email, organizationId);
}
