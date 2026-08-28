import crypto from "node:crypto";
import { google } from "googleapis";

import { getGoogleServiceAccountPrivateKey } from "@/lib/google-service-account";
import { cachedSheetsRead, invalidateSheetsCache, withSheetsBackoff } from "@/lib/sheets-cache";
import { assertBalanceCovers, CREDIT_COST, type CreditEvent, summarizeLedger } from "@/lib/ella-credit-math";
import { getPortalConfigNumber } from "@/lib/portal-config";

export { CREDIT_COST, EllaCreditsError } from "@/lib/ella-credit-math";
export type { CreditEvent } from "@/lib/ella-credit-math";

/**
 * Ella Credits ledger.
 *
 * A single org-wide balance meters every AI action in the portal. The ledger
 * tab is append-only: one row per top-up or deduction, and the usable balance
 * is always the sum of `Credits_Delta` over every row (the `Balance_After`
 * column is written for audit convenience but is never trusted on read).
 *
 * Google Sheets has no atomic increment, so a burst of concurrent deductions
 * (e.g. the bulk-upload worker pool at concurrency 2) can momentarily overspend
 * by a couple of credits. That is acceptable for this internal, low-volume
 * tool; callers still pre-check the whole unit of work up front via
 * `assertCreditsAvailable` before doing any paid work.
 */

const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = getGoogleServiceAccountPrivateKey();

if (!spreadsheetId || !serviceAccountEmail || !privateKey) {
  throw new Error("Ella Credits ledger access is not configured.");
}

const auth = new google.auth.JWT({
  email: serviceAccountEmail,
  key: privateKey,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const TAB = "Ella_Credit_Ledger";
const HEADERS = [
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
];
const CACHE_KEY = `${TAB}:L:${spreadsheetId}`;

export type LedgerEntry = {
  entryId: string;
  timestamp: string;
  type: "TopUp" | "Deduction";
  event: string;
  units: number;
  creditsDelta: number;
  balanceAfter: number;
  reference: string;
  roleId: string;
  actorName: string;
  actorEmail: string;
  note: string;
};

export type CreditBalance = {
  balance: number;
  totals: { toppedUp: number; consumed: number };
  entries: LedgerEntry[];
};

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

async function readEntries(): Promise<LedgerEntry[]> {
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

export async function getCreditBalance(options: { fresh?: boolean } = {}): Promise<CreditBalance> {
  const entries = options.fresh
    ? await withSheetsBackoff(readEntries)
    : await cachedSheetsRead(CACHE_KEY, readEntries);
  const { balance, toppedUp, consumed } = summarizeLedger(entries);
  return { balance, totals: { toppedUp, consumed }, entries };
}

/**
 * Reads the live balance and throws `EllaCreditsError` when it cannot cover
 * `units` of `event`. Call this before doing any paid work. Returns the
 * projected balance after the spend.
 */
const CREDIT_COST_SETTING: Record<CreditEvent, "Ella_Credit_Cost_CV_Analysis" | "Ella_Credit_Cost_Phone_Interview"> = {
  cv_analysis: "Ella_Credit_Cost_CV_Analysis",
  phone_interview: "Ella_Credit_Cost_Phone_Interview",
};

/** Live per-unit credit cost for an event: Settings override, else the default. */
export async function creditCostFor(event: CreditEvent): Promise<number> {
  const configured = await getPortalConfigNumber(CREDIT_COST_SETTING[event], CREDIT_COST[event]);
  return Number.isFinite(configured) && configured >= 0 ? Math.trunc(configured) : CREDIT_COST[event];
}

export async function assertCreditsAvailable(units: number, event: CreditEvent): Promise<number> {
  const [{ balance }, cost] = await Promise.all([getCreditBalance({ fresh: true }), creditCostFor(event)]);
  return assertBalanceCovers(balance, units, cost);
}

async function appendRow(row: (string | number)[]) {
  await ensureTab();
  await withSheetsBackoff(() => sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${TAB}'!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  }));
  invalidateSheetsCache(TAB);
}

export async function recordDeduction(input: {
  event: CreditEvent;
  units: number;
  reference: string;
  roleId?: string;
  actorName?: string;
  actorEmail?: string;
  note?: string;
}): Promise<void> {
  const units = Math.max(1, Math.trunc(input.units));
  const [{ balance }, cost] = await Promise.all([getCreditBalance({ fresh: true }), creditCostFor(input.event)]);
  const delta = -units * cost;
  await appendRow([
    `LDG-${crypto.randomUUID()}`,
    new Date().toISOString(),
    "Deduction",
    input.event,
    units,
    delta,
    balance + delta,
    text(input.reference),
    text(input.roleId),
    text(input.actorName),
    text(input.actorEmail),
    text(input.note),
  ]);
}

export async function recordTopUp(input: {
  amount: number;
  actorName: string;
  actorEmail: string;
  note: string;
}): Promise<CreditBalance> {
  const amount = Math.trunc(input.amount);
  if (!Number.isFinite(amount) || amount === 0) throw new Error("Top-up amount must be a non-zero whole number.");
  const { balance } = await getCreditBalance({ fresh: true });
  await appendRow([
    `LDG-${crypto.randomUUID()}`,
    new Date().toISOString(),
    "TopUp",
    amount > 0 ? "manual_topup" : "manual_adjustment",
    Math.abs(amount),
    amount,
    balance + amount,
    "",
    "",
    text(input.actorName),
    text(input.actorEmail),
    text(input.note),
  ]);
  return getCreditBalance({ fresh: true });
}
