// READ-ONLY parity check — Google Sheet `Ella_Credit_Ledger` vs Neon
// `credit_ledger` / `credit_balance`.
//
// This script ONLY reads. It issues SELECT statements against Postgres and one
// `spreadsheets.readonly` Google Sheets API call. It NEVER inserts, updates,
// deletes, reconciles, calls the backfill path, changes `CREDITS_BACKEND`,
// touches Neon settings, or contacts n8n. Safe to run repeatedly during the
// `dual` soak.
//
// Run: `npm run db:check:credits`
//   (or: `node --env-file-if-exists=.env.local src/db/check-credit-parity.mjs`)
//
// Exit codes:
//   0  PASS    — every must-match parity check passed
//   1  FAIL    — at least one mismatch (do NOT reconcile automatically; investigate)
//   2  BLOCKED — missing credentials / a source could not be read / invalid ledger shape
//               (this is explicitly NOT a PASS)
import { google } from "googleapis";
import { neon } from "@neondatabase/serverless";

const TAB = "Ella_Credit_Ledger";
// Deterministic keys the backfill assigns to sheet rows that have a blank
// `Entry_ID` (`backfill-credits.mjs`). They legitimately exist only in Postgres.
const SYNTHETIC_PREFIX = "SHEET-";
// Postgres-target (Scenario C) ledger entries are committed atomically inside a
// Postgres transaction by the internal API (e.g. target bulk resume screening).
// n8n/Sheets is not part of that transaction, so these rows are Sheets-absent
// BY DESIGN — the sheet is stale for exactly them, not a parity defect. They
// are matched by `actor_email = 'pilot-target-worker'` or a `Postgres target `
// note prefix, and excluded from the sheet-equality assertions (9, 12, 13),
// which instead reconcile "Postgres leads the sheet by the target-only rows".

const databaseUrl = process.env.DATABASE_URL?.trim();
// The ledger workbook is explicit via GOOGLE_CREDITS_SPREADSHEET_ID; it falls
// back to the main recruitment workbook only for backwards compatibility. The
// pilot main workbook does NOT contain the Ella_Credit_Ledger tab, so the
// explicit var must be set to whichever spreadsheet the deployed pilot writes
// credits to.
const spreadsheetId = (process.env.GOOGLE_CREDITS_SPREADSHEET_ID || process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "").trim();
const creditsSpreadsheetIsFallback =
  !process.env.GOOGLE_CREDITS_SPREADSHEET_ID?.trim() && Boolean(process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim());
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "")
  .replace(/^"(.*)"$/s, "$1")
  .replace(/\\n/g, "\n")
  .trim();

function blocked(message) {
  console.error(`BLOCKED — ${message}`);
  console.error("This is NOT a PASS. Provide DATABASE_URL + Google service-account");
  console.error("credentials (in .env.local or the environment) and re-run.");
  process.exit(2);
}

if (!spreadsheetId) {
  blocked(
    "GOOGLE_CREDITS_SPREADSHEET_ID is not configured (and GOOGLE_SHEETS_SPREADSHEET_ID is also unset). " +
      "Set GOOGLE_CREDITS_SPREADSHEET_ID to the spreadsheet that holds the 'Ella_Credit_Ledger' tab.",
  );
}

const missingEnv = Object.entries({
  DATABASE_URL: databaseUrl,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: serviceAccountEmail,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missingEnv.length > 0) blocked(`missing credentials: ${missingEnv.join(", ")}`);

const toInt = (value) => {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};
const preview = (list) => {
  if (list.length === 0) return "none";
  const head = list.slice(0, 10).join(", ");
  return list.length > 10 ? `[${head}, +${list.length - 10} more]` : `[${head}]`;
};

// ---------------------------------------------------------------------------
// Sheet side — readonly scope, single GET
// ---------------------------------------------------------------------------
let headers = [];
let sheetRows = [];
try {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  // Explicit tab-existence check first, so a missing tab gives a clear message
  // instead of the Google client's opaque "Unable to parse range" error.
  let meta;
  try {
    meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "properties.title,sheets.properties.title" });
  } catch (error) {
    blocked(
      `could not open the credits spreadsheet ${spreadsheetId}: ${error?.message ?? error}. ` +
        `Check GOOGLE_CREDITS_SPREADSHEET_ID and that it is shared with ${serviceAccountEmail}.`,
    );
  }
  const tabTitles = (meta.data.sheets ?? []).map((s) => s.properties?.title).filter(Boolean);
  if (!tabTitles.includes(TAB)) {
    const where = creditsSpreadsheetIsFallback
      ? "GOOGLE_CREDITS_SPREADSHEET_ID is unset, so this checked the main recruitment workbook (GOOGLE_SHEETS_SPREADSHEET_ID). "
      : "";
    blocked(
      `the '${TAB}' tab does not exist in spreadsheet ${spreadsheetId} ("${meta.data.properties?.title ?? "?"}"). ` +
        where +
        `Set GOOGLE_CREDITS_SPREADSHEET_ID to the workbook the deployed pilot actually writes credits to. ` +
        `Tabs present: ${tabTitles.join(", ") || "none"}.`,
    );
  }

  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!A:L` });
  const values = response.data.values ?? [];
  headers = (values[0] ?? []).map((cell) => String(cell ?? "").trim());
  sheetRows = values.slice(1).filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
} catch (error) {
  blocked(`could not read the '${TAB}' sheet: ${error?.message ?? error}`);
}

for (const required of ["Entry_ID", "Credits_Delta"]) {
  if (!headers.includes(required)) {
    blocked(`the '${TAB}' sheet has no '${required}' column (headers seen: ${headers.join(", ") || "none"})`);
  }
}
const colIndex = (name) => headers.indexOf(name);

const sheetEntryIdsRaw = sheetRows.map((row) => String(row[colIndex("Entry_ID")] ?? "").trim());
const sheetBlankIdCount = sheetEntryIdsRaw.filter((id) => id === "").length;
const sheetEntryIds = sheetEntryIdsRaw.filter((id) => id !== "");
const sheetEntryIdSet = new Set(sheetEntryIds);
const sheetDuplicateIds = [...new Set(sheetEntryIds.filter((id, index) => sheetEntryIds.indexOf(id) !== index))];
const sheetRowCount = sheetRows.length;
const sheetSum = sheetRows.reduce((total, row) => total + toInt(row[colIndex("Credits_Delta")]), 0);
const sheetLastBalanceAfter =
  headers.includes("Balance_After") && sheetRows.length > 0
    ? toInt(sheetRows[sheetRows.length - 1][colIndex("Balance_After")])
    : null;

// ---------------------------------------------------------------------------
// Postgres side — SELECT only
// ---------------------------------------------------------------------------
let pgBalance = 0;
let pgRowCount = 0;
let pgDeltaSum = 0;
let pgLatest = null;
let pgIds = [];
let pgRowDetail = new Map();
let pgNullIdCount = 0;
let pgDuplicateRows = [];
try {
  const sql = neon(databaseUrl);

  const balanceRows = await sql`select balance from credit_balance where id = 1`;
  if (balanceRows.length === 0) {
    blocked("credit_balance row (id = 1) is missing — verify the approved credit migration with `npm run db:migrate -- --target=0001_init_credit_ledger.sql`");
  }
  pgBalance = toInt(balanceRows[0].balance);

  const aggregate = await sql`
    select count(*)::int          as rows,
           coalesce(sum(credits_delta), 0)::int as delta_sum,
           max(entry_time)         as latest
    from credit_ledger`;
  pgRowCount = toInt(aggregate[0].rows);
  pgDeltaSum = toInt(aggregate[0].delta_sum);
  pgLatest = aggregate[0].latest;

  const idRows = await sql`
    select source_entry_id,
           type,
           event,
           coalesce(credits_delta, 0)::int as credits_delta,
           coalesce(actor_email, '')       as actor_email,
           coalesce(note, '')              as note,
           entry_time
    from credit_ledger
    where source_entry_id is not null
    order by entry_time`;
  pgIds = idRows.map((row) => String(row.source_entry_id));
  pgRowDetail = new Map(idRows.map((row) => [String(row.source_entry_id), row]));

  const nullRows = await sql`select count(*)::int as n from credit_ledger where source_entry_id is null`;
  pgNullIdCount = toInt(nullRows[0].n);

  pgDuplicateRows = await sql`
    select source_entry_id, count(*)::int as n
    from credit_ledger
    where source_entry_id is not null
    group by source_entry_id
    having count(*) > 1`;
} catch (error) {
  blocked(`could not read Postgres: ${error?.message ?? error}`);
}

const pgIdSet = new Set(pgIds);
const pgSyntheticKeys = pgIds.filter((id) => id.startsWith(SYNTHETIC_PREFIX));

// A Postgres row is a "Scenario C" target-only entry — committed atomically
// inside a Postgres transaction by the internal API, with n8n/Sheets outside
// that transaction — when the worker actor or the target note says so. These
// are Sheets-absent BY DESIGN and are only ever expected on the Postgres side.
const isScenarioC = (row) =>
  row && (String(row.actor_email) === "pilot-target-worker" || /^Postgres target /i.test(String(row.note ?? "")));

// ---------------------------------------------------------------------------
// Compare — Postgres is the immutable source of truth; the Sheet is a mirror.
// ---------------------------------------------------------------------------
const pgDuplicateIds = pgDuplicateRows.map((row) => `${row.source_entry_id} x${row.n}`);

// Direction A — a Sheet row with no Postgres row. This is the dangerous
// direction: the immutable ledger is missing an authoritative write. Always FAIL.
const idsMissingInPostgres = sheetEntryIds.filter((id) => !pgIdSet.has(id));

// Direction B — a Postgres row not mirrored to the Sheet. SHEET-* synthetic
// keys correspond to blank-Entry_ID Sheet rows (already in the Sheet totals),
// so they are not "missing". Everything else splits into Scenario C (by design)
// and rows that still need a Sheet mirror.
const pgOnlyIds = pgIds.filter((id) => !sheetEntryIdSet.has(id) && !id.startsWith(SYNTHETIC_PREFIX));
const pgOnlyScenarioC = pgOnlyIds.filter((id) => isScenarioC(pgRowDetail.get(id)));
const pgOnlyUnmirrored = pgOnlyIds.filter((id) => !isScenarioC(pgRowDetail.get(id)));
const deltaOf = (ids) => ids.reduce((total, id) => total + toInt(pgRowDetail.get(id)?.credits_delta), 0);
const pgOnlyDelta = deltaOf(pgOnlyIds);

// Balance integrity — no credits invented or lost. The Sheet sum plus every
// Postgres-only delta (Scenario C + not-yet-mirrored alike) must equal both the
// Postgres running balance and the Postgres ledger sum.
const balancesReconcile = pgBalance === pgDeltaSum && pgDeltaSum === sheetSum + pgOnlyDelta;
const rowCountsReconcile = sheetRowCount + pgOnlyIds.length + pgSyntheticKeys.length === pgRowCount;
const blanksReconcile = pgNullIdCount === 0 && pgSyntheticKeys.length === sheetBlankIdCount;

const latestText = pgLatest instanceof Date ? pgLatest.toISOString() : String(pgLatest ?? "n/a");

console.log(`Ella Credits parity check — '${TAB}'  (READ-ONLY; no writes)`);
console.log("");
console.log("Reported values");
console.log(`   1  Sheets credit balance (Σ Credits_Delta) . ${sheetSum}`);
console.log(`   2  Postgres credit_balance.balance ......... ${pgBalance}`);
console.log(`   3  Postgres ledger Σ credits_delta ......... ${pgDeltaSum}`);
console.log(`   4  Sheets ledger row count ................. ${sheetRowCount}`);
console.log(`   5  Postgres ledger row count .............. ${pgRowCount}`);
console.log(`   6  Sheet Entry_ID set size ................ ${sheetEntryIdSet.size}  (blank Entry_ID rows: ${sheetBlankIdCount})`);
console.log(`   7  Postgres source_entry_id set size ...... ${pgIdSet.size}  (synthetic ${pgSyntheticKeys.length}, NULL ${pgNullIdCount})`);
console.log(`      Postgres-only rows ................... ${pgOnlyIds.length}  (Scenario C by design ${pgOnlyScenarioC.length}, awaiting Sheet mirror ${pgOnlyUnmirrored.length}), Σ delta ${pgOnlyDelta}`);
console.log(`      Sheet last Balance_After ............... ${sheetLastBalanceAfter ?? "n/a"}`);
console.log(`      Postgres latest entry_time ............ ${latestText}`);
console.log("");

// --- Categorised reconciliation report ------------------------------------
console.log("Reconciliation report");
console.log(`   A  Sheet rows missing from the Postgres ledger .. ${idsMissingInPostgres.length}  ${preview(idsMissingInPostgres)}`);
console.log(`   B  Postgres rows missing from the Sheet mirror .. ${pgOnlyIds.length}`);
console.log(`        - Scenario C (target-only, by design) ...... ${pgOnlyScenarioC.length}  ${preview(pgOnlyScenarioC)}`);
console.log(`        - awaiting Sheet mirror (needs review) ..... ${pgOnlyUnmirrored.length}  ${preview(pgOnlyUnmirrored)}`);
for (const id of pgOnlyUnmirrored) {
  const row = pgRowDetail.get(id) ?? {};
  console.log(`             ${id}  ${row.type}/${row.event}  ${toInt(row.credits_delta) >= 0 ? "+" : ""}${toInt(row.credits_delta)}  "${String(row.note ?? "").slice(0, 80)}"`);
}
console.log(`   C  Balance differences .......................... Sheet Σ ${sheetSum}  +  Postgres-only Σ ${pgOnlyDelta}  =  ${sheetSum + pgOnlyDelta}  (Postgres balance ${pgBalance}, ledger Σ ${pgDeltaSum})`);
console.log(`   D  Duplicate source ids ........................ sheet ${preview(sheetDuplicateIds)} / pg ${preview(pgDuplicateIds)}`);
console.log(`   E  Unresolved partial writes (NULL source id) .. ${pgNullIdCount}`);
console.log("");

const hardChecks = [
  ["H1 no Sheet rows missing from the immutable Postgres ledger", idsMissingInPostgres.length === 0, preview(idsMissingInPostgres)],
  ["H2 no duplicate source ids (Sheet or Postgres)", sheetDuplicateIds.length === 0 && pgDuplicateIds.length === 0, `sheet ${preview(sheetDuplicateIds)} / pg ${preview(pgDuplicateIds)}`],
  ["H3 no NULL source_entry_id; blank Entry_IDs reconcile to synthetic keys", blanksReconcile, `pg NULL ${pgNullIdCount}; sheet blank ${sheetBlankIdCount} vs pg synthetic ${pgSyntheticKeys.length}`],
  ["H4 balances reconcile (PG balance == PG Σ == Sheet Σ + all Postgres-only Σ)", balancesReconcile, `${pgBalance} / ${pgDeltaSum} / ${sheetSum} + ${pgOnlyDelta}`],
  ["H5 row counts reconcile (Sheet + Postgres-only + synthetic == Postgres)", rowCountsReconcile, `${sheetRowCount} + ${pgOnlyIds.length} + ${pgSyntheticKeys.length} vs ${pgRowCount}`],
];

console.log("Integrity assertions (a failure here blocks sign-off)");
let failed = 0;
for (const [label, pass, detail] of hardChecks) {
  if (!pass) failed += 1;
  console.log(`   ${pass ? "PASS" : "FAIL"}  ${label}  →  ${detail}`);
}
console.log("");

const warn = pgOnlyUnmirrored.length > 0;
if (warn) {
  console.log(`WARNING — ${pgOnlyUnmirrored.length} Postgres ledger entr${pgOnlyUnmirrored.length === 1 ? "y is" : "ies are"} not yet mirrored to the Sheet.`);
  console.log("  The balances still reconcile (no credits lost or invented), but the Sheet");
  console.log("  audit trail is incomplete. Review the rows listed above, then run:");
  console.log("    node src/db/reconcile-credit-sheet-mirror.mjs            (dry run — review)");
  console.log("    node src/db/reconcile-credit-sheet-mirror.mjs --commit   (append the missing rows; never re-charges)");
  console.log("");
}

const ok = failed === 0;
if (!ok) {
  console.log(`OVERALL: FAIL — ${failed} integrity assertion(s) failed. Do NOT reconcile automatically; investigate the cause first.`);
} else if (warn) {
  console.log("OVERALL: PASS WITH WARNINGS — ledger integrity holds; Sheet mirror has a documented, reconcilable gap.");
} else {
  console.log("OVERALL: PASS — Sheets and Postgres credit ledgers reconcile with no outstanding mirror gap.");
}
console.log("");
console.log("This script made no writes to Postgres, Google Sheets, or anything else.");
process.exit(ok ? 0 : 1);
