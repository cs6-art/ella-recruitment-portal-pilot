import crypto from "node:crypto";
import { google } from "googleapis";
import { getGoogleServiceAccountPrivateKey } from "@/lib/google-service-account";
import { cachedSheetsRead, invalidateSheetsCache } from "@/lib/sheets-cache";

/**
 * Per-HR-user Microsoft OneDrive OAuth tokens, stored separately from both the
 * Google Drive and calendar connections. Same encrypted-at-rest,
 * one-row-per-email pattern as `drive-tokens.ts` / `calendar-tokens.ts`.
 * Used only to browse and download resume files the HR user picks for bulk
 * screening (Microsoft Graph scope: Files.Read).
 */

const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = getGoogleServiceAccountPrivateKey();

if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID is not configured.");
if (!serviceAccountEmail) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL is not configured.");
if (!privateKey) throw new Error("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not configured.");

const auth = new google.auth.JWT({ email: serviceAccountEmail, key: privateKey, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const sheets = google.sheets({ version: "v4", auth });

const TAB = "Microsoft_Drive_Connections";
const HEADERS = ["Email", "Access_Token", "Refresh_Token", "Token_Expires_At", "Scope", "Connected_At", "Last_Updated"];

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return crypto.scryptSync(secret, "microsoft-drive-token-encryption", 32);
}

function encrypt(value: string): string {
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(value: string): string {
  if (!value) return "";
  try {
    const buf = Buffer.from(value, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export type MicrosoftDriveConnection = {
  email: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
  scope: string;
  connectedAt: string;
};

let ensureTabPromise: Promise<void> | null = null;

async function ensureTab() {
  if (!ensureTabPromise) {
    ensureTabPromise = (async () => {
      const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(title))" });
      if (metadata.data.sheets?.some((s) => s.properties?.title === TAB)) return;
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
      await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${TAB}'!A1`, valueInputOption: "RAW", requestBody: { values: [HEADERS] } });
    })().catch((error) => {
      ensureTabPromise = null;
      throw error;
    });
  }
  return ensureTabPromise;
}

async function readRows(): Promise<{ rows: string[][]; rowNumbers: number[] }> {
  await ensureTab();
  const values = await cachedSheetsRead(`${TAB}:G:${spreadsheetId}`, async () => {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!A1:G` });
    return res.data.values ?? [];
  });
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  values.slice(1).forEach((row, i) => {
    if (!row.some((v) => text(v))) return;
    rows.push(row.map(text));
    rowNumbers.push(i + 2);
  });
  return { rows, rowNumbers };
}

export async function getMicrosoftDriveConnection(email: string): Promise<MicrosoftDriveConnection | null> {
  const normalized = email.trim().toLowerCase();
  const { rows } = await readRows();
  const row = rows.find((r) => text(r[0]).toLowerCase() === normalized);
  if (!row) return null;
  return {
    email: text(row[0]),
    accessToken: decrypt(text(row[1])),
    refreshToken: decrypt(text(row[2])),
    tokenExpiresAt: text(row[3]),
    scope: text(row[4]),
    connectedAt: text(row[5]),
  };
}

export async function saveMicrosoftDriveConnection(input: { email: string; accessToken: string; refreshToken?: string; tokenExpiresAt: string; scope: string }): Promise<void> {
  const normalized = input.email.trim().toLowerCase();
  const now = new Date().toISOString();
  const { rows, rowNumbers } = await readRows();
  const existingIndex = rows.findIndex((r) => text(r[0]).toLowerCase() === normalized);

  const previousRefreshToken = existingIndex >= 0 ? decrypt(text(rows[existingIndex][2])) : "";
  const refreshToken = input.refreshToken || previousRefreshToken;

  const values = [
    normalized,
    encrypt(input.accessToken),
    encrypt(refreshToken),
    input.tokenExpiresAt,
    input.scope,
    existingIndex >= 0 ? rows[existingIndex][5] || now : now,
    now,
  ];

  if (existingIndex >= 0) {
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${TAB}'!A${rowNumbers[existingIndex]}:G${rowNumbers[existingIndex]}`, valueInputOption: "RAW", requestBody: { values: [values] } });
  } else {
    await sheets.spreadsheets.values.append({ spreadsheetId, range: `'${TAB}'!A1`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [values] } });
  }
  invalidateSheetsCache(TAB);
}

export async function deleteMicrosoftDriveConnection(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const { rows, rowNumbers } = await readRows();
  const index = rows.findIndex((r) => text(r[0]).toLowerCase() === normalized);
  if (index < 0) return;
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${TAB}'!A${rowNumbers[index]}:G${rowNumbers[index]}` });
  invalidateSheetsCache(TAB);
}
