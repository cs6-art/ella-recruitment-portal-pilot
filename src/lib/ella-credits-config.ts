/**
 * Where the Ella Credit ledger Google Sheet lives.
 *
 * Historically the ledger tab (`Ella_Credit_Ledger`) was assumed to be inside
 * the main recruitment workbook (`GOOGLE_SHEETS_SPREADSHEET_ID`) and the portal
 * created it there lazily on first use. After the pilot/production spreadsheet
 * split that assumption broke: the pilot main workbook has no such tab, so a
 * parity check against it fails with an obscure `Unable to parse range` error.
 *
 * `GOOGLE_CREDITS_SPREADSHEET_ID` makes the credits workbook explicit. When it
 * is unset the behaviour is exactly as before (fall back to the main workbook),
 * so setting/unsetting it is a safe, reversible switch.
 */

export const CREDIT_LEDGER_TAB = "Ella_Credit_Ledger";

/** A→L, in write order — kept here so the app, backfill and parity all agree. */
export const CREDIT_LEDGER_HEADERS = [
  "Entry_ID",
  "Timestamp",
  "Type",
  "Event",
  "Units",
  "Credits_Delta",
  "Balance_After",
  "Reference",
  "Role_ID",
  "Actor_Name",
  "Actor_Email",
  "Note",
] as const;

/**
 * The spreadsheet id that holds `Ella_Credit_Ledger`. Prefers the explicit
 * `GOOGLE_CREDITS_SPREADSHEET_ID`; falls back to the main recruitment workbook
 * for backwards compatibility. Returns `""` when neither is configured — the
 * caller must surface a clear "not configured" error rather than letting the
 * Google client fail on an empty id.
 */
export function creditsSpreadsheetId(env: NodeJS.ProcessEnv = process.env): string {
  return (env.GOOGLE_CREDITS_SPREADSHEET_ID || env.GOOGLE_SHEETS_SPREADSHEET_ID || "").trim();
}

/** True when the ledger spreadsheet id was taken from the fallback, not the explicit var. */
export function creditsSpreadsheetIsFallback(env: NodeJS.ProcessEnv = process.env): boolean {
  return !(env.GOOGLE_CREDITS_SPREADSHEET_ID || "").trim() && Boolean((env.GOOGLE_SHEETS_SPREADSHEET_ID || "").trim());
}
