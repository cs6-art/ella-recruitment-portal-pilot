// Copy the remaining Google Sheet stores into Postgres:
//   - User_Directory        -> users (McLink default organization)
//   - Settings              -> portal_settings (McLink default organization)
//   - Calendar_Connections  -> oauth_connections (provider google_calendar)
//   - Drive_Connections     -> oauth_connections (provider google_drive)
//   - Microsoft_Drive_Connections -> oauth_connections (provider microsoft_drive)
//
// Safe by design:
//   * Dry run by default; `--commit` is required to write.
//   * Insert-only. A row that already exists in Postgres is never overwritten,
//     so re-running is harmless and never clobbers newer edits made in the portal.
//   * Never deletes anything, in Postgres or in the sheets.
//   * OAuth tokens are copied still-encrypted (same key, same format).
//
// Run:
//   node --env-file=.env.local src/db/backfill-sheets-to-postgres.mjs            (dry run)
//   node --env-file=.env.local src/db/backfill-sheets-to-postgres.mjs --commit
//
// Exit codes: 0 ok · 1 write error · 2 blocked (missing credentials).
import { google } from "googleapis";
import { neon } from "@neondatabase/serverless";

const commit = process.argv.includes("--commit");
const DEFAULT_ORG = "00000000-0000-4000-8000-000000000001";

const databaseUrl = process.env.DATABASE_URL?.trim();
const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/^"(.*)"$/s, "$1").replace(/\\n/g, "\n").trim();

if (!databaseUrl || !spreadsheetId || !serviceAccountEmail || !privateKey) {
  console.error("BLOCKED — DATABASE_URL, GOOGLE_SHEETS_SPREADSHEET_ID and the service account credentials are required.");
  process.exit(2);
}

const sql = neon(databaseUrl);
const auth = new google.auth.JWT({ email: serviceAccountEmail, key: privateKey, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
const sheets = google.sheets({ version: "v4", auth });

const text = (value) => String(value ?? "").trim();
const bool = (value) => ["true", "yes", "1", "y"].includes(text(value).toLowerCase());

async function readTab(range) {
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return response.data.values ?? [];
  } catch (error) {
    if (/Unable to parse range|not found/i.test(String(error?.message))) return [];
    throw error;
  }
}

const summary = { users: { read: 0, inserted: 0, existing: 0 }, settings: { read: 0, inserted: 0, existing: 0 }, tokens: { read: 0, inserted: 0, existing: 0 } };

async function backfillUsers() {
  const rows = await readTab("User_Directory!A2:L");
  for (const row of rows) {
    const email = text(row[0]).toLowerCase();
    if (!email) continue;
    summary.users.read += 1;
    const [existing] = await sql`select id from users where organization_id = ${DEFAULT_ORG} and email = ${email}`;
    if (existing) { summary.users.existing += 1; continue; }
    summary.users.inserted += 1;
    if (!commit) continue;
    let departmentId = null;
    const department = text(row[3]);
    if (department) {
      const nameKey = department.toLowerCase();
      const [found] = await sql`select id from departments where organization_id = ${DEFAULT_ORG} and name_key = ${nameKey}`;
      if (found) departmentId = found.id;
      else {
        const [created] = await sql`insert into departments (organization_id, name, name_key) values (${DEFAULT_ORG}, ${department}, ${nameKey}) on conflict do nothing returning id`;
        departmentId = created?.id ?? (await sql`select id from departments where organization_id = ${DEFAULT_ORG} and name_key = ${nameKey}`)[0]?.id ?? null;
      }
    }
    // Columns: A email, B name, C role, D dept, E create, F review, G approve, H settings, I users, J active, K dept-review, L credits
    await sql`insert into users (organization_id, email, full_name, access_role, department_id, can_create_role, can_review_role, can_approve_role, can_edit_settings, can_manage_users, can_manage_credits, can_review_department_role, active)
      values (${DEFAULT_ORG}, ${email}, ${text(row[1])}, ${text(row[2])}, ${departmentId}, ${bool(row[4])}, ${bool(row[5])}, ${bool(row[6])}, ${bool(row[7])}, ${bool(row[8])}, ${bool(row[11])}, ${bool(row[10])}, ${row[9] === undefined || text(row[9]) === "" ? true : bool(row[9])})
      on conflict do nothing`;
  }
}

async function backfillSettings() {
  const rows = await readTab("Settings!A1:F");
  const headerIndex = rows.findIndex((row) => row.some((cell) => text(cell).toLowerCase().replace(/[ _]/g, "_") === "setting_key"));
  if (headerIndex < 0) return;
  for (const row of rows.slice(headerIndex + 1)) {
    const key = text(row[0]);
    if (!key) continue;
    summary.settings.read += 1;
    const [existing] = await sql`select 1 as present from portal_settings where organization_id = ${DEFAULT_ORG} and key = ${key}`;
    if (existing) { summary.settings.existing += 1; continue; }
    summary.settings.inserted += 1;
    if (!commit) continue;
    await sql`insert into portal_settings (organization_id, key, value, category, updated_by) values (${DEFAULT_ORG}, ${key}, ${text(row[1])}, ${text(row[2])}, ${text(row[5])}) on conflict do nothing`;
  }
}

async function backfillTokens(tab, provider) {
  const rows = (await readTab(`${tab}!A1:G`)).slice(1);
  for (const row of rows) {
    const email = text(row[0]).toLowerCase();
    if (!email) continue;
    summary.tokens.read += 1;
    const [existing] = await sql`select 1 as present from oauth_connections where organization_id = ${DEFAULT_ORG} and provider = ${provider} and user_email = ${email}`;
    if (existing) { summary.tokens.existing += 1; continue; }
    summary.tokens.inserted += 1;
    if (!commit) continue;
    const expires = text(row[3]) ? new Date(text(row[3])) : null;
    const connectedAt = text(row[5]) ? new Date(text(row[5])) : new Date();
    await sql`insert into oauth_connections (organization_id, user_email, provider, access_token_enc, refresh_token_enc, token_expires_at, scope, account_email, connected_at)
      values (${DEFAULT_ORG}, ${email}, ${provider}, ${text(row[1])}, ${text(row[2])}, ${expires && Number.isFinite(expires.getTime()) ? expires.toISOString() : null}, ${text(row[4])}, ${email}, ${Number.isFinite(connectedAt.getTime()) ? connectedAt.toISOString() : new Date().toISOString()})
      on conflict do nothing`;
  }
}

try {
  await backfillUsers();
  await backfillSettings();
  await backfillTokens("Calendar_Connections", "google_calendar");
  await backfillTokens("Drive_Connections", "google_drive");
  await backfillTokens("Microsoft_Drive_Connections", "microsoft_drive");
  console.log(commit ? "COMMITTED" : "DRY RUN (nothing written; pass --commit to write)");
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error("Backfill failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
