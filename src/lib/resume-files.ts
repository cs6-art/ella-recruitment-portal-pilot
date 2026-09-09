import crypto from "node:crypto";
import { Readable } from "node:stream";
import path from "node:path";

import { google } from "googleapis";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";

import { getGoogleServiceAccountPrivateKey } from "@/lib/google-service-account";
import { requireBulkResumeUatConfig, type BulkResumeEnvironment } from "@/lib/bulk-resume-config";
import { getPortalConfigValue } from "@/lib/portal-config";
import { createPdfTextParser } from "@/lib/pdf-text-parser";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";

// This module is the single server-side boundary for resume validation,
// extraction, private storage, download tokens, and retention cleanup.
//
// Storage backend: Google Drive, not local disk. This app is deployed on
// Vercel, whose serverless functions have a read-only filesystem (writes
// only work under /tmp, and /tmp is neither durable nor shared across
// instances) -- so files written to process.cwd()-relative paths, as this
// module used to do, would fail in production and were never actually
// exercised outside local dev. Since the rest of the system is deliberately
// Sheets-only for data, and a 10 MB PDF is far past what a Sheets cell can
// hold, Drive is the natural fit: it's already the service account this app
// uses, needs no new paid infrastructure, and gives real persistence.
export const MAX_RESUME_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_RESUME_REQUEST_BYTES = MAX_RESUME_FILE_BYTES + 512 * 1024;
export const RESUME_RETENTION_DAYS = 30;

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_MIME = "application/msword";

export type ResumeFileKind = "pdf" | "docx" | "doc";

export type ResumeFileRecord = {
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  uploadedAt: string;
  expiresAt: string;
  kind: ResumeFileKind;
};

export type StoredResume = {
  record: ResumeFileRecord;
  extractedText: string;
  reused: boolean;
};

function accessSecret() {
  const secret = process.env.N8N_WEBHOOK_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error("Resume download signing is not configured.");
  return secret;
}

let driveClient: ReturnType<typeof google.drive> | null = null;

function drive() {
  if (driveClient) return driveClient;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = getGoogleServiceAccountPrivateKey();
  if (!email || !key) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not configured.");
  // drive.file alone can read app-created PDFs while returning 404 for an
  // existing Shared Drive root. Read-only metadata access lets us verify the
  // approved destination without granting unrestricted Drive write access.
  const auth = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive.readonly"] });
  driveClient = google.drive({ version: "v3", auth });
  return driveClient;
}

async function resumeFolderId(environment: BulkResumeEnvironment = "production") {
  if (environment === "uat") {
    requireBulkResumeUatConfig();
    return process.env.BULK_RESUME_UAT_DRIVE_FOLDER_ID!.trim();
  }
  // Postgres target mode must not depend on the Settings sheet for an
  // operational storage destination. A Sheets quota failure must not prevent
  // a valid target intake from reaching the Postgres queue. Keep the legacy
  // Settings lookup for the legacy backend only.
  if (isPostgresRecruitmentTarget()) {
    const targetFolderId = process.env.RESUME_STORAGE_DRIVE_FOLDER_ID?.trim();
    if (!targetFolderId) throw new Error("RESUME_STORAGE_DRIVE_FOLDER_ID is required for Postgres recruitment target intake.");
    return targetFolderId;
  }
  const folderId = (await getPortalConfigValue("Resume_Storage_Drive_Folder_ID")).trim();
  if (!folderId) throw new Error("Resume storage Drive folder is not configured (Settings -> Infrastructure or RESUME_STORAGE_DRIVE_FOLDER_ID).");
  return folderId;
}

function safeFileName(value: string) {
  const base = path.basename(value).replace(/[^a-zA-Z0-9._ -]/g, "_").trim();
  return base.slice(0, 180) || "resume";
}

// Drive file IDs are opaque, service-generated strings (typically 28-44
// base64url-ish characters) -- nothing like the RES-<uuid> format this
// module minted itself when it managed local filenames directly.
function isPlausibleDriveFileId(value: string) {
  return /^[a-zA-Z0-9_-]{10,80}$/.test(value);
}

function detectKind(fileName: string, mimeType: string): ResumeFileKind | null {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".pdf" && (!mimeType || mimeType === PDF_MIME || mimeType === "application/octet-stream")) return "pdf";
  if (extension === ".docx" && (!mimeType || mimeType === DOCX_MIME || mimeType === "application/octet-stream")) return "docx";
  // Legacy binary Word format (pre-2007). Distinct from "docx" (a zip/XML
  // container) -- needs its own OLE compound-file parser below.
  if (extension === ".doc" && (!mimeType || mimeType === DOC_MIME || mimeType === "application/octet-stream")) return "doc";
  return null;
}

function assertSignature(buffer: Buffer, kind: ResumeFileKind) {
  if (kind === "pdf") {
    const header = buffer.subarray(0, Math.min(buffer.length, 1024)).toString("latin1");
    if (!header.includes("%PDF-")) throw new Error("The uploaded PDF signature is invalid.");
    return;
  }

  if (kind === "docx") {
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
      throw new Error("The uploaded DOCX signature is invalid.");
    }
    return;
  }

  // Legacy .doc files are OLE2 compound documents, signed D0 CF 11 E0 A1 B1
  // 1A E1 -- a completely different container format from DOCX's zip header.
  const oleSignature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (buffer.length < oleSignature.length || !oleSignature.every((byte, index) => buffer[index] === byte)) {
    throw new Error("The uploaded DOC signature is invalid.");
  }
}

const CONTROL_CHAR_PATTERN = new RegExp(String.fromCharCode(0), "g");

function normalizeExtractedText(value: string) {
  return value.replace(CONTROL_CHAR_PATTERN, " ").replace(/[ \t]+/g, " ").replace(/\r?\n\s*/g, "\n").trim().slice(0, 50000);
}

async function extractText(buffer: Buffer, kind: ResumeFileKind) {
  let textValue: string;
  if (kind === "pdf") {
    const parser = createPdfTextParser(buffer);
    try {
      textValue = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else if (kind === "docx") {
    textValue = (await mammoth.extractRawText({ buffer })).value;
  } else {
    textValue = await new WordExtractor().extract(buffer).then((document) => document.getBody());
  }
  const text = normalizeExtractedText(textValue || "");
  if (text.length < 20) throw new Error("The uploaded resume does not contain enough readable text.");
  return text;
}

function retentionExpiry(uploadedAt: Date) {
  const expiresAt = new Date(uploadedAt);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + RESUME_RETENTION_DAYS);
  return expiresAt.toISOString();
}

function kindFromProperty(value: string | null | undefined): ResumeFileKind | null {
  return value === "pdf" || value === "docx" || value === "doc" ? value : null;
}

type DriveFileFields = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  size?: string | null;
  createdTime?: string | null;
  properties?: Record<string, string> | null;
};

function recordFromDriveFile(file: DriveFileFields): ResumeFileRecord | null {
  const kind = kindFromProperty(file.properties?.kind);
  const expiresAt = file.properties?.expiresAt;
  const sha256 = file.properties?.sha256;
  if (!file.id || !file.name || !kind || !expiresAt || !sha256) return null;
  return {
    fileId: file.id,
    fileName: file.name,
    mimeType: file.mimeType || resumeMimeType(kind),
    size: Number(file.size || 0),
    sha256,
    uploadedAt: file.createdTime || new Date(0).toISOString(),
    expiresAt,
    kind,
  };
}

/** Remove expired resumes from the Drive storage folder. */
export async function cleanupExpiredResumeFiles(now = Date.now()) {
  const client = drive();
  const folderId = await resumeFolderId();
  let scanned = 0;
  let deleted = 0;
  let pageToken: string | undefined;

  do {
    const response = await client.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, size, createdTime, properties)",
      pageSize: 200,
      pageToken,
      // Service accounts have no personal Drive storage quota. These flags
      // keep retention cleanup compatible with the Shared Drive used for
      // uploaded resumes.
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    const files = response.data.files || [];
    scanned += files.length;
    for (const file of files) {
      const expiresAt = file.properties?.expiresAt;
      if (expiresAt && Date.parse(expiresAt) <= now && file.id) {
        await client.files.delete({ fileId: file.id, supportsAllDrives: true }).catch(() => undefined);
        deleted += 1;
      }
    }
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return { deleted, scanned };
}

let lastCleanupAt = 0;
let cleanupInFlight: Promise<unknown> | null = null;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function cleanupIfDue() {
  // Preview deployments must never mutate the shared production Drive folder
  // as a side effect of a user upload.
  if (process.env.VERCEL_ENV === "preview") return;
  const now = Date.now();
  if (cleanupInFlight) return cleanupInFlight;
  if (lastCleanupAt + CLEANUP_INTERVAL_MS > now) return;
  lastCleanupAt = now;
  cleanupInFlight = cleanupExpiredResumeFiles(now)
    .catch((error) => console.warn("[Resume Cleanup] Unable to remove expired files:", error))
    .finally(() => { cleanupInFlight = null; });
  return cleanupInFlight;
}

export async function storeResumeFile(file: File, options: { environment?: BulkResumeEnvironment } = {}): Promise<StoredResume> {
  await cleanupIfDue().catch(() => undefined);
  const fileName = safeFileName(file.name || "resume");
  const kind = detectKind(fileName, file.type);
  if (!kind) throw new Error("Only PDF, DOC, and DOCX resume files are supported.");
  if (!file.size) throw new Error("The uploaded resume is empty.");
  if (file.size > MAX_RESUME_FILE_BYTES) throw new Error("Resume files must be 10 MB or smaller.");

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length !== file.size) throw new Error("The uploaded resume could not be read completely.");
  assertSignature(buffer, kind);
  const extractedText = await extractText(buffer, kind);
  const uploadedAt = new Date();
  const mimeType = resumeMimeType(kind);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const expiresAt = retentionExpiry(uploadedAt);

  // Queue history can predate the current jobId contract. Reuse a matching
  // non-expired Drive object when it is already present, so re-submitting a
  // resume after a lost historical queue write does not create another file.
  const folderId = await resumeFolderId(options.environment);
  console.info("[Resume Storage] destination", { folderId, fileName, authentication: "service_account" });
  // Source retrieval uses the user's OAuth connection; destination storage
  // uses the service account. Report these failures separately.
  await drive().files.get({
    fileId: folderId,
    fields: "id,mimeType,capabilities(canAddChildren)",
    supportsAllDrives: true,
  }).then(({ data }) => {
    if (data.mimeType !== "application/vnd.google-apps.folder" || data.capabilities?.canAddChildren === false) {
      throw new Error("Resume storage destination must be a writable folder for the service account.");
    }
  }).catch(() => {
    throw new Error(`Resume storage destination unavailable to the service account (${folderId}). Verify RESUME_STORAGE_DRIVE_FOLDER_ID and Shared Drive access.`);
  });
  const existing = await drive().files.list({
    q: `'${folderId}' in parents and trashed = false and properties has { key='sha256' and value='${sha256}' }`,
    fields: "files(id, name, mimeType, size, createdTime, properties)",
    pageSize: 10,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  const existingRecord = (existing.data.files || [])
    .map(recordFromDriveFile)
    .find((record): record is ResumeFileRecord => Boolean(record && new Date(record.expiresAt).getTime() > Date.now()));
  if (existingRecord) return { record: existingRecord, extractedText, reused: true };

  const response = await drive().files.create({
    // Upload into a Shared Drive folder rather than the service account's
    // quota-less personal Drive space.
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      parents: [folderId],
      properties: { kind, sha256, expiresAt },
    },
    media: { mimeType, body: Readable.from(buffer) },
    fields: "id, name, mimeType, size, createdTime, properties",
  });

  const record = recordFromDriveFile(response.data);
  if (!record) throw new Error("Unable to store the uploaded resume.");
  return { record, extractedText, reused: false };
}

export async function getResumeFileRecord(fileId: string) {
  if (!isPlausibleDriveFileId(fileId)) return null;
  try {
    const response = await drive().files.get({ fileId, fields: "id, name, mimeType, size, createdTime, properties, trashed", supportsAllDrives: true });
    if (response.data.trashed) return null;
    const record = recordFromDriveFile(response.data);
    if (!record) return null;
    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      await deleteResumeFile(record).catch(() => undefined);
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

export async function readResumeFile(record: ResumeFileRecord) {
  const response = await drive().files.get({ fileId: record.fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
  return Buffer.from(response.data as ArrayBuffer);
}

/** Read and validate a stored resume for the Postgres screening worker. */
export async function extractStoredResumeText(record: ResumeFileRecord) {
  const buffer = await readResumeFile(record);
  assertSignature(buffer, record.kind);
  return extractText(buffer, record.kind);
}

export async function deleteResumeFile(record: ResumeFileRecord) {
  await drive().files.delete({ fileId: record.fileId, supportsAllDrives: true }).catch((error) => {
    // Already gone (e.g. a concurrent cleanup) is not a failure worth surfacing.
    if ((error as { code?: number })?.code !== 404) throw error;
  });
}

export function createResumeDownloadToken(fileId: string, expiresAt: string) {
  const payload = Buffer.from(JSON.stringify({ fileId, exp: new Date(expiresAt).getTime() }), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", accessSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyResumeDownloadToken(token: string, fileId: string) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = crypto.createHmac("sha256", accessSecret()).update(payload).digest("base64url");
  if (signature.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { fileId?: string; exp?: number };
    return decoded.fileId === fileId && typeof decoded.exp === "number" && decoded.exp > Date.now();
  } catch {
    return false;
  }
}

export function resumeMimeType(kind: ResumeFileKind) {
  return kind === "pdf" ? PDF_MIME : kind === "docx" ? DOCX_MIME : DOC_MIME;
}

export const resumeFileConstants = {
  pdfMimeType: PDF_MIME,
  docxMimeType: DOCX_MIME,
  docMimeType: DOC_MIME,
};
