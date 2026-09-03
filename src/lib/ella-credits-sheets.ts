import { google } from "googleapis";

import { getGoogleServiceAccountPrivateKey } from "@/lib/google-service-account";
import { cachedSheetsRead, invalidateSheetsCache, withSheetsBackoff } from "@/lib/sheets-cache";
import { summarizeLedger } from "@/lib/ella-credit-math";
import { CREDIT_LEDGER_HEADERS, CREDIT_LEDGER_TAB, creditsSpreadsheetId } from "@/lib/ella-credits-config";
import type { CreditBalance, LedgerAppend, LedgerEntry } from "@/lib/ella-credits-store";

/**
 * Google Sheets storage for the Ella Credit ledger — the original
 * implementation, unchanged in behaviour. Append-only tab, balance = sum of
 * every row's delta. Non-atomic: a burst of concurrent deductions can briefly
 * overspend (documented limitation; the Postgres store fixes it).
 */

const spreadsheetId = creditsSpreadsheetId();
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = getGoogleServiceAccountPrivateKey();

if (!spreadsheetId || !serviceAccountEmail || !privateKey) {
  throw new Error(
    "Ella Credits ledger access is not configured (need GOOGLE_CREDITS_SPREADSHEET_ID or GOOGLE_SHEETS_SPREADSHEET_ID, plus the Google service account).",
  );
}

const auth = new google.auth.JWT({
  email: serviceAccountEmail,
  key: privateKey,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const TAB = CREDIT_LEDGER_TAB;
const HEADERS = [...CREDIT_LEDGER_HEADERS];
const CACHE_KEY = `${TAB}:L:${spreadsheetId}`;

function text(value: unknown) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function toInt(value: unknown) {
  const parsed = Number(text(value));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

let ensureTabPromise: Promise<void> | null = null;

async function ensureTab() {
  if (!ensureTabPromise) {
    ensureTabPromise = (async () => {
      const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(title))" });
      const exists = metadata.data.sheets?.some((sheet) => sheet.properties?.title === TAB);
      if (exists) return;
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${TAB}'!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [HEADERS] },
      });
    })().catch((error) => {
      ensureTabPromise = null;
      throw error;
    });
  }
  return ensureTabPromise;
}

export async function readSheetLedgerEntries(): Promise<LedgerEntry[]> {
  await ensureTab();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!A:L` });
  const values = response.data.values ?? [];
  const headers = (values[0] ?? []).map(text);
  const index = (name: string) => headers.indexOf(name);
  return values.slice(1)
    .filter((row) => row.some((cell) => text(cell) !== ""))
    .map((row): LedgerEntry => ({
      entryId: text(row[index("Entry_ID")]),
      timestamp: text(row[index("Timestamp")]),
      type: text(row[index("Type")]) === "TopUp" ? "TopUp" : "Deduction",
      event: text(row[index("Event")]),
      units: toInt(row[index("Units")]),
      creditsDelta: toInt(row[index("Credits_Delta")]),
      balanceAfter: toInt(row[index("Balance_After")]),
      reference: text(row[index("Reference")]),
      roleId: text(row[index("Role_ID")]),
      actorName: text(row[index("Actor_Name")]),
      actorEmail: text(row[index("Actor_Email")]),
      note: text(row[index("Note")]),
    }));
}

export async function getSheetCreditBalance(options: { fresh?: boolean } = {}): Promise<CreditBalance> {
  const entries = options.fresh
    ? await withSheetsBackoff(readSheetLedgerEntries)
    : await cachedSheetsRead(CACHE_KEY, readSheetLedgerEntries);
  const { balance, toppedUp, consumed } = summarizeLedger(entries);
  return { balance, totals: { toppedUp, consumed }, entries };
}

/**
 * Non-atomic: reads the current sum, then appends one row with
 * `Balance_After = previous + delta`. `guard` is ignored — the Sheets store
 * never blocks a spend.
 */
export async function appendSheetLedgerEntry(entry: LedgerAppend): Promise<{ balanceAfter: number; applied: boolean }> {
  await ensureTab();
  const existing = await withSheetsBackoff(readSheetLedgerEntries);
  // Idempotency: a repeated sourceEntryId (deterministic caller key, or a
  // replayed mirror) must not append a second row. Random `LDG-<uuid>` keys
  // never collide, so the historical path is unchanged.
  const prior = entry.sourceEntryId
    ? existing.find((row) => row.entryId === entry.sourceEntryId)
    : undefined;
  if (prior) {
    const { balance } = summarizeLedger(existing);
    return { balanceAfter: balance, applied: false };
  }
  const { balance } = summarizeLedger(existing);
  const balanceAfter = balance + entry.creditsDelta;
  await withSheetsBackoff(() => sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${TAB}'!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        entry.sourceEntryId,
        new Date().toISOString(),
        entry.type,
        entry.event,
        entry.units,
        entry.creditsDelta,
        balanceAfter,
        text(entry.reference),
        text(entry.roleId),
        text(entry.actorName),
        text(entry.actorEmail),
        text(entry.note),
      ]],
    },
  }));
  invalidateSheetsCache(TAB);
  return { balanceAfter, applied: true };
}
