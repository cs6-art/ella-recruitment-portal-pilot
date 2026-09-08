// Auditable, one-off corrective ledger entry for a single mis-billed voice
// attempt. SAFE BY DEFAULT: dry-run unless --commit is passed.
//
// Background: before the classifier fix, a Vapi `customer-busy` terminal reason
// fell through the no-answer bucket and was billed as `phone_interview_incomplete`
// (-8) instead of `phone_interview_no_answer` (-5). This tool appends ONE
// corrective TopUp row (it never deletes ledger history) that nets the
// difference back, keyed deterministically so a re-run is a no-op.
//
// Examples:
//   node src/db/correct-voice-billing-attempt.mjs \
//     --bad-entry=4e14bba7-3ea1-4065-980a-8960fe34992b --amount=3
//   node src/db/correct-voice-billing-attempt.mjs \
//     --bad-entry=4e14bba7-3ea1-4065-980a-8960fe34992b --amount=3 --commit

import crypto from "node:crypto";
import { google } from "googleapis";
import { neon } from "@neondatabase/serverless";

const args = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf("=");
  return eq === -1 ? "true" : hit.slice(eq + 1);
};

const commit = flag("commit") === "true";
const badEntryId = flag("bad-entry").trim();
const amount = Math.trunc(Number(flag("amount", "0")));
const actorEmail = flag("actor", "websupport@mclinkgroup.com").trim();
const reason = flag(
  "reason",
  "customer-busy mis-billed as phone_interview_incomplete (-8); corrected to phone_interview_no_answer (-5)",
).trim();

if (!badEntryId) { console.error("BLOCKED — pass --bad-entry=<ledger entry id being corrected>."); process.exit(2); }
if (!Number.isFinite(amount) || amount === 0) { console.error("BLOCKED — pass a non-zero --amount (e.g. --amount=3 to refund 3 credits)."); process.exit(2); }

const databaseUrl = process.env.DATABASE_URL?.trim();
const spreadsheetId = (process.env.GOOGLE_CREDITS_SPREADSHEET_ID || process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "").trim();
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/^"(.*)"$/s, "$1").replace(/\\n/g, "\n").trim();

if (!spreadsheetId) { console.error("BLOCKED — GOOGLE_CREDITS_SPREADSHEET_ID / GOOGLE_SHEETS_SPREADSHEET_ID is not set."); process.exit(2); }
for (const [name, value] of Object.entries({ GOOGLE_SERVICE_ACCOUNT_EMAIL: serviceAccountEmail, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey })) {
  if (!value) { console.error(`BLOCKED — ${name} is not set.`); process.exit(2); }
}

const TAB = "Ella_Credit_Ledger";
// Same deterministic shape ella-credits.ts uses for idempotency keys, so a
// mirror/replay collapses to a single billing identity.
const sourceEntryId = `LDG-${crypto.createHash("sha256").update(`voice-billing-correction:${badEntryId}`).digest("hex")}`;

const auth = new google.auth.JWT({ email: serviceAccountEmail, key: privateKey, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const sheets = google.sheets({ version: "v4", auth });

const text = (cell) => (cell === undefined || cell === null ? "" : String(cell).trim());
const int = (cell) => { const n = Number(text(cell)); return Number.isFinite(n) ? Math.trunc(n) : 0; };

const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!A:L` });
const values = response.data.values ?? [];
const headers = (values[0] ?? []).map(text);
const col = (name) => headers.indexOf(name);
const rows = values.slice(1).filter((row) => row.some((cell) => text(cell) !== ""));

const balanceBefore = rows.reduce((sum, row) => sum + int(row[col("Credits_Delta")]), 0);
const badRow = rows.find((row) => text(row[col("Entry_ID")]) === badEntryId);
const already = rows.find((row) => text(row[col("Entry_ID")]) === sourceEntryId);

console.log(`voice billing correction — ${commit ? "COMMIT (writing)" : "DRY RUN (no writes)"}`);
console.log(`  bad entry:            ${badEntryId}${badRow ? ` (${text(badRow[col("Event")])} ${int(badRow[col("Credits_Delta")])})` : " — NOT FOUND in ledger"}`);
console.log(`  correction entry:     ${sourceEntryId}`);
console.log(`  correction amount:    ${amount > 0 ? "+" : ""}${amount}`);
console.log(`  balance before:       ${balanceBefore}`);
console.log(`  balance after:        ${balanceBefore + (already ? 0 : amount)}`);

if (already) { console.log("Correction row already present — nothing to do (idempotent)."); process.exit(0); }
if (!badRow) { console.error("BLOCKED — the entry being corrected was not found; refusing to guess."); process.exit(2); }
if (!commit) { console.log("\nDry run only. Re-run with --commit to append the corrective row."); process.exit(0); }

const balanceAfter = balanceBefore + amount;
await sheets.spreadsheets.values.append({
  spreadsheetId,
  range: `'${TAB}'!A1`,
  valueInputOption: "USER_ENTERED",
  insertDataOption: "INSERT_ROWS",
  requestBody: {
    values: [[
      sourceEntryId,
      new Date().toISOString(),
      "TopUp",
      "billing_correction",
      Math.abs(amount),
      amount,
      balanceAfter,
      badEntryId,
      "",
      "Automated Correction",
      actorEmail,
      reason,
    ]],
  },
});
console.log("Sheets: corrective row appended.");

if (databaseUrl) {
  const sql = neon(databaseUrl);
  await sql`
    insert into "credit_ledger"
      ("entry_time", "type", "event", "units", "credits_delta", "balance_after",
       "reference", "role_id", "actor_name", "actor_email", "note", "source_entry_id")
    values (${new Date().toISOString()}, 'TopUp', 'billing_correction', ${Math.abs(amount)}, ${amount},
            ${balanceAfter}, ${badEntryId}, '', 'Automated Correction', ${actorEmail}, ${reason}, ${sourceEntryId})
    on conflict ("source_entry_id") do nothing
  `;
  const [{ sum }] = await sql`select coalesce(sum("credits_delta"), 0) as sum from "credit_ledger"`;
  await sql`
    insert into "credit_balance" ("id", "balance") values (1, ${Number(sum)})
    on conflict ("id") do update set "balance" = excluded."balance", "updated_at" = now()
  `;
  console.log(`Postgres: mirrored; balance now ${Number(sum)}.`);
} else {
  console.log("Postgres: DATABASE_URL unset — Sheets-only correction (fine while CREDITS_BACKEND=sheets).");
}

console.log(`\nOK — balance ${balanceBefore} -> ${balanceAfter}.`);
