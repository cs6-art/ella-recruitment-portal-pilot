// One-off, idempotent backfill of the Ella Credit ledger from the Google Sheet
// into Postgres. Safe to re-run (ON CONFLICT DO NOTHING on source_entry_id).
// Run: `npm run db:backfill:credits`
import crypto from "node:crypto";
import { google } from "googleapis";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL?.trim();
const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "")
  .replace(/^"(.*)"$/s, "$1")
  .replace(/\\n/g, "\n")
  .trim();

for (const [name, value] of Object.entries({ DATABASE_URL: databaseUrl, GOOGLE_SHEETS_SPREADSHEET_ID: spreadsheetId, GOOGLE_SERVICE_ACCOUNT_EMAIL: serviceAccountEmail, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey })) {
  if (!value) { console.error(`${name} is not set (put it in .env.local).`); process.exit(1); }
}

const TAB = "Ella_Credit_Ledger";
const sql = neon(databaseUrl);

const auth = new google.auth.JWT({ email: serviceAccountEmail, key: privateKey, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
const sheets = google.sheets({ version: "v4", auth });

const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!A:L` });
const values = response.data.values ?? [];
if (values.length < 2) { console.log("Sheet ledger is empty — nothing to backfill."); process.exit(0); }

const headers = (values[0] ?? []).map((cell) => String(cell ?? "").trim());
const col = (name) => headers.indexOf(name);
const text = (cell) => (cell === undefined || cell === null ? "" : String(cell).trim());
const int = (cell) => { const n = Number(text(cell)); return Number.isFinite(n) ? Math.trunc(n) : 0; };

const rows = values.slice(1).filter((row) => row.some((cell) => text(cell) !== ""));

let inserted = 0;
let sum = 0;
for (const [i, row] of rows.entries()) {
  const delta = int(row[col("Credits_Delta")]);
  sum += delta;
  const rawId = text(row[col("Entry_ID")]);
  const timestamp = text(row[col("Timestamp")]) || new Date(0).toISOString();
  // Rows without an Entry_ID get a deterministic synthetic key from their content + position.
  const sourceEntryId = rawId || `SHEET-${i}-${crypto.createHash("sha1").update(`${timestamp}|${delta}|${text(row[col("Event")])}|${text(row[col("Reference")])}`).digest("hex").slice(0, 16)}`;
  const type = text(row[col("Type")]) === "TopUp" ? "TopUp" : "Deduction";

  const result = await sql`
    insert into "credit_ledger"
      ("entry_time", "type", "event", "units", "credits_delta", "balance_after",
       "reference", "role_id", "actor_name", "actor_email", "note", "source_entry_id")
    values (${timestamp}, ${type}, ${text(row[col("Event")])}, ${int(row[col("Units")])}, ${delta},
            ${int(row[col("Balance_After")])}, ${text(row[col("Reference")])}, ${text(row[col("Role_ID")])},
            ${text(row[col("Actor_Name")])}, ${text(row[col("Actor_Email")])}, ${text(row[col("Note")])}, ${sourceEntryId})
    on conflict ("source_entry_id") do nothing
    returning "id"
  `;
  if (result.length > 0) inserted += 1;
}

await sql`
  insert into "credit_balance" ("id", "balance") values (1, ${sum})
  on conflict ("id") do update set "balance" = excluded."balance", "updated_at" = now()
`;

const [{ balance: pgBalance }] = await sql`select "balance" from "credit_balance" where "id" = 1`;

console.log(`Sheet rows:            ${rows.length}`);
console.log(`Inserted this run:     ${inserted} (rest already present)`);
console.log(`Sheet balance (sum):   ${sum}`);
console.log(`Postgres balance:      ${pgBalance}`);

if (Number(pgBalance) !== sum) {
  console.error("MISMATCH — Postgres balance does not equal the sheet sum. Investigate before cutting over.");
  process.exit(1);
}
console.log("OK — balances match.");
