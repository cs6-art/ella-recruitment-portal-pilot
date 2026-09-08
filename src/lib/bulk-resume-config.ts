import { getPortalConfigValue } from "@/lib/portal-config";

export type BulkResumeEnvironment = "production" | "uat";

// A missing terminal callback must not leave the operator-facing queue stuck
// indefinitely. The downstream webhook is bounded to one minute, so ten
// minutes gives legitimate Sheets/applicant writes time to settle.
export const STALE_PROCESSING_MS = 10 * 60 * 1000;

function enabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function isBulkResumeUatMode() {
  return enabled(process.env.BULK_RESUME_UAT_MODE);
}

export function bulkResumeEnvironment(): BulkResumeEnvironment {
  return isBulkResumeUatMode() ? "uat" : "production";
}

/** Temporary marker for a controlled Production canary. It never reroutes
 * storage or Sheets; it only labels one explicitly named batch as UAT. */
export function productionUatBatchId() {
  return isBulkResumeUatMode() ? "" : process.env.BULK_RESUME_PRODUCTION_UAT_BATCH_ID?.trim() || "";
}

export function bulkResumeIsUatMarked() {
  return isBulkResumeUatMode() || Boolean(productionUatBatchId());
}

/**
 * UAT must have its own destinations. Do not fall back to Production IDs when
 * the feature is explicitly enabled: a missing UAT variable is safer as a
 * visible configuration error than as a silent Production write.
 */
export function requireBulkResumeUatConfig() {
  if (!isBulkResumeUatMode()) return;
  if (!process.env.BULK_RESUME_UAT_DRIVE_FOLDER_ID?.trim()) {
    throw new Error("BULK_RESUME_UAT_DRIVE_FOLDER_ID is required when BULK_RESUME_UAT_MODE=true.");
  }
  if (!process.env.BULK_RESUME_UAT_SPREADSHEET_ID?.trim()) {
    throw new Error("BULK_RESUME_UAT_SPREADSHEET_ID is required when BULK_RESUME_UAT_MODE=true.");
  }
  if (!process.env.N8N_BULK_RESUME_UPLOAD_UAT_WEBHOOK_URL?.trim()) {
    throw new Error("N8N_BULK_RESUME_UPLOAD_UAT_WEBHOOK_URL is required when BULK_RESUME_UAT_MODE=true.");
  }
  if (!process.env.N8N_BULK_RESUME_UAT_WEBHOOK_SECRET?.trim()) {
    throw new Error("N8N_BULK_RESUME_UAT_WEBHOOK_SECRET is required when BULK_RESUME_UAT_MODE=true.");
  }
}

export async function bulkResumeWebhookConfig() {
  if (isBulkResumeUatMode()) {
    requireBulkResumeUatConfig();
    return {
      url: process.env.N8N_BULK_RESUME_UPLOAD_UAT_WEBHOOK_URL!.trim(),
      secret: process.env.N8N_BULK_RESUME_UAT_WEBHOOK_SECRET!.trim(),
    };
  }
  const url = (await getPortalConfigValue("N8N_Bulk_Resume_Upload_Webhook_URL")).trim();
  const secret = process.env.N8N_WEBHOOK_SECRET?.trim();
  if (!url || !secret) throw new Error("The bulk screening workflow is not configured.");
  return { url, secret };
}

export function bulkResumeSpreadsheetId() {
  if (isBulkResumeUatMode()) {
    requireBulkResumeUatConfig();
    return process.env.BULK_RESUME_UAT_SPREADSHEET_ID!.trim();
  }
  const spreadsheetId = process.env.GOOGLE_CANDIDATE_SPREADSHEET_ID?.trim() || process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) throw new Error("Candidate spreadsheet access is not configured.");
  return spreadsheetId;
}
