// Reconcile the Google Sheet credit ledger mirror FROM the Postgres ledger.
//
// Postgres `credit_ledger` is the immutable source of truth. In `dual` mode
// every normal write goes to the Sheet first and is mirrored to Postgres, so
// the Sheet is normally complete. Rows can still end up Postgres-only:
//   - "Scenario C" target-only charges committed atomically inside a Postgres
//     transaction by the internal API (n8n/Sheets outside that transaction), and
//   - out-of-band manual corrections applied directly to Postgres.
//
// This tool APPENDS those missing rows to the Sheet so the audit trail is
// complete. It is safe:
//   * READ-ONLY by default (dry run). `--commit` is required to write.
//   * It only ever APPENDS to the Sheet ledger tab. It never updates or deletes
//     an existing row, and never touches `credit_balance` or Postgres at all.
//   * Idempotent: a row whose Entry_ID is already in the Sheet is skipped, so
//     re-running (or racing another run) cannot double-write.
//   * It does NOT call `recordDeduction` / `recordTopUp` — the applicant is
//     never charged again. It copies the existing Postgres ledger row verbatim.
//   * It refuses to run if any Sheet row is missing from Postgres (the
//     dangerous direction — a lost authoritative write that a human must
//     investigate first).
//
// Run:
//   node src/db/reconcile-credit-sheet-mirror.mjs                    (dry run)
//   node src/db/reconcile-credit-sheet-mirror.mjs --commit           (mirror manual/other Postgres-only rows)
//   node src/db/reconcile-credit-sheet-mirror.mjs --commit --include-scenario-c   (also mirror target-only rows)
//   node src/db/reconcile-credit-sheet-mirror.mjs --commit --only=LDG-<id>        (mirror one row)
//
// Exit codes: 0 ok / nothing to do · 1 refused or write error · 2 blocked (creds).
import { google } from "googleapis";
import { neon } from "@neondatabase/serverless";

const args = new Set(process.argv.slice(2));
const commit = args.has("--commit");
const includeScenarioC = args.has("--include-scenario-c");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const onlyId = onlyArg ? onlyArg.slice("--only=".length).trim() : null;

const TAB = "Ella_Credit_Ledger";
const SYNTHETIC_PREFIX = "SHEET-";

const databaseUrl = process.env.DATABASE_URL?.trim();
const spreadsheetId = (process.env.GOOGLE_CREDITS_SPREADSHEET_ID || process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "").trim();
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/^"(.*)"$/s, "$1").replace(/\\n/g, "\n").trim();

function blocked(message) {
  console.error(`BLOCKED — ${message}`);
  process.exit(2);
}
function refuse(message) {
  console.error(`REFUSED — ${message}`);
  process.exit(1);
}

if (!spreadsheetId) blocked("set GOOGLE_CREDITS_SPREADSHEET_ID (or GOOGLE_SHEETS_SPREADSHEET_ID) to the workbook holding the 'Ella_Credit_Ledger' tab.");
for (const [name, value] of Object.entries({ DATABASE_URL: databaseUrl, GOOGLE_SERVICE_ACCOUNT_EMAIL: serviceAccountEmail, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey })) {
  if (!value) blocked(`missing ${name}`);
}

const toInt = (value) => {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};
const text = (value) => (value === undefined || value === null ? "" : String(value).trim());
const isScenarioC = (row) => text(row.actor_email) === "pilot-target-worker" || /^Postgres target /i.test(text(row.note));

// Write scope only needed for --commit; a dry run stays readonly.
const auth = new google.auth.JWT({
  email: serviceAccountEmail,
  key: privateKey,
  scopes: [commit ? "https://www.googleapis.com/auth/spreadsheets" : "https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });
const sql = neon(databaseUrl);

// --- Sheet side -------------------------------------------------------------
let headers = [];
let sheetRows = [];
try {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!A:L` });
  const values = response.data.values ?? [];
  headers = (values[0] ?? []).map(text);
  sheetRows = values.slice(1).filter((row) => row.some((cell) => text(cell) !== ""));
} catch (error) {
  blocked(`could not read the '${TAB}' sheet: ${error?.message ?? error}`);
}
for (const required of ["Entry_ID", "Credits_Delta"]) {
  if (!headers.includes(required)) blocked(`the '${TAB}' sheet has no '${required}' column`);
}
const col = (name) => headers.indexOf(name);
const sheetIds = new Set(sheetRows.map((row) => text(row[col("Entry_ID")])).filter(Boolean));
let sheetSum = sheetRows.reduce((total, row) => total + toInt(row[col("Credits_Delta")]), 0);

// --- Postgres side (SELECT only) -------------------------------------------
const pgRows = await sql`
  select source_entry_id, entry_time, type, event, coalesce(units, 0)::int as units,
         coalesce(credits_delta, 0)::int as credits_delta,
         coalesce(reference, '') as reference, coalesce(role_id, '') as role_id,
         coalesce(actor_name, '') as actor_name, coalesce(actor_email, '') as actor_email,
         coalesce(note, '') as note
  from credit_ledger
  where source_entry_id is not null
  order by entry_time`;

// Refuse on the dangerous direction: a Sheet row absent from the immutable ledger.
const pgIds = new Set(pgRows.map((r) => String(r.source_entry_id)));
const sheetOnly = [...sheetIds].filter((id) => !pgIds.has(id) && !id.startsWith(SYNTHETIC_PREFIX));
if (sheetOnly.length > 0) {
  refuse(
    `${sheetOnly.length} Sheet row(s) are missing from the Postgres ledger: ${sheetOnly.slice(0, 5).join(", ")}` +
      (sheetOnly.length > 5 ? ", …" : "") +
      `. Postgres is the source of truth — a human must investigate a lost authoritative write before any mirror repair.`,
  );
}

let candidates = pgRows.filter(
  (r) => !sheetIds.has(String(r.source_entry_id)) && !String(r.source_entry_id).startsWith(SYNTHETIC_PREFIX),
);
if (onlyId) candidates = candidates.filter((r) => String(r.source_entry_id) === onlyId);
if (!includeScenarioC && !onlyId) candidates = candidates.filter((r) => !isScenarioC(r));

console.log(`Reconcile credit Sheet mirror — source of truth: Postgres credit_ledger`);
console.log(`  mode: ${commit ? "COMMIT (append to Sheet)" : "DRY RUN (no writes)"}`);
console.log(`  scope: ${onlyId ? `only ${onlyId}` : includeScenarioC ? "all Postgres-only rows" : "manual / non-Scenario-C Postgres-only rows"}`);
console.log(`  Postgres-only rows to mirror: ${candidates.length}`);
console.log("");
for (const r of candidates) {
  const d = toInt(r.credits_delta);
  console.log(`  ${r.source_entry_id}  ${r.type}/${r.event}  ${d >= 0 ? "+" : ""}${d}  ${isScenarioC(r) ? "[Scenario C] " : ""}"${text(r.note).slice(0, 80)}"`);
}
console.log("");

if (candidates.length === 0) {
  console.log("Nothing to mirror.");
  process.exit(0);
}
if (!commit) {
  console.log("Dry run only. Re-run with --commit to append these rows to the Sheet ledger.");
  console.log("This appends rows verbatim from Postgres. It never re-charges, never edits an existing row, never touches credit_balance.");
  process.exit(0);
}

// --- Commit: append each missing row, re-checking idempotency -----------------
let appended = 0;
for (const r of candidates) {
  const id = String(r.source_entry_id);
  // Re-read to close the race window: skip if it appeared in the Sheet since.
  const fresh = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!A:A` });
  const present = new Set((fresh.data.values ?? []).flat().map(text));
  if (present.has(id)) {
    console.log(`  skip (already in Sheet): ${id}`);
    continue;
  }
  const delta = toInt(r.credits_delta);
  sheetSum += delta;
  const timestamp = r.entry_time instanceof Date ? r.entry_time.toISOString() : text(r.entry_time);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${TAB}'!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        id,
        timestamp,
        text(r.type),
        text(r.event),
        toInt(r.units),
        delta,
        sheetSum, // running Sheet balance after this appended row
        text(r.reference),
        text(r.role_id),
        text(r.actor_name),
        text(r.actor_email),
        `${text(r.note)} [mirrored from Postgres ledger ${new Date().toISOString().slice(0, 10)}]`,
      ]],
    },
  });
  appended += 1;
  console.log(`  appended: ${id}  (${delta >= 0 ? "+" : ""}${delta})`);
}

console.log("");
console.log(`Done. ${appended} row(s) appended to the '${TAB}' Sheet. No Postgres writes, no credit_balance change, no re-charge.`);
console.log("Re-run `npm run db:check:credits` to confirm the mirror gap is closed.");
process.exit(0);
