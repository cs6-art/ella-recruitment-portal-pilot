// Destructive recruitment-only reset for the Ella pilot database.
//
// SAFE BY DEFAULT: the exact confirmation flag and the pilot database marker
// are both required. This script never references credit/payment tables or
// _migrations, and it does not read or modify Google Sheets.

import { neon } from "@neondatabase/serverless";

const confirmed = process.argv.includes("--confirm-pilot-reset");
const rawUrl = process.env.DATABASE_URL?.trim();
const protectedTables = ["credit_ledger", "credit_balance", "credit_balances", "payments", "payment_events", "_migrations"];
const recruitmentTables = [
  "booking_tokens",
  "screening_results",
  "screening_invitations",
  "application_status_history",
  "voice_call_logs",
  "voice_interview_results",
  "voice_call_attempts",
  "interview_slots",
  "bulk_screening_queue_items",
  "applicant_aliases",
  "applications",
  "resume_files",
  "applicants",
  "role_status_history",
  "roles",
  "oauth_connections",
  "portal_settings",
  "users",
  "departments",
];

if (!confirmed) {
  console.error("Refusing recruitment reset. Re-run with --confirm-pilot-reset after reviewing the target.");
  process.exit(2);
}
if (!rawUrl) {
  console.error("BLOCKED — DATABASE_URL is not configured.");
  process.exit(2);
}

const url = new URL(rawUrl);
const isPilotMain = url.hostname.toLowerCase().includes("weathered-haze-aukfuaij") && url.pathname === "/neondb";
if (!isPilotMain) {
  console.error("BLOCKED — DATABASE_URL is not the confirmed Ella pilot main database.");
  process.exit(2);
}
if (protectedTables.some((name) => recruitmentTables.includes(name))) {
  console.error("BLOCKED — reset table allowlist overlaps a protected table.");
  process.exit(2);
}

const sql = neon(rawUrl);
const countRows = async (table) => Number((await sql.query(`select count(*)::int as count from "${table}"`, []))[0].count);
const snapshot = async () => Object.fromEntries(await Promise.all(recruitmentTables.map(async (table) => [table, await countRows(table)])));
const protectedSnapshot = async () => (await sql`select
  (select count(*)::int from credit_ledger) as ledger_rows,
  (select coalesce(sum(credits_delta), 0) as ledger_sum from credit_ledger),
  (select count(*)::int from payments) as payment_rows,
  (select count(*)::int from payment_events) as payment_event_rows,
  (select count(*)::int from "_migrations") as migration_rows`)[0];

try {
  const before = await snapshot();
  const protectedBefore = await protectedSnapshot();
  console.log(JSON.stringify({ target: "pilot-main", database: url.pathname.slice(1), before, protectedBefore }, null, 2));
  await sql.transaction(recruitmentTables.map((table) => sql.query(`delete from "${table}"`, [])));
  const after = await snapshot();
  const protectedAfter = await protectedSnapshot();
  console.log(JSON.stringify({ after, protectedAfter }, null, 2));
  if (Object.values(after).some((count) => count !== 0)) throw new Error("recruitment reset did not leave all allowlisted tables empty");
  if (JSON.stringify(protectedBefore) !== JSON.stringify(protectedAfter)) throw new Error("protected credit/payment/migration state changed");
  console.log("PILOT RECRUITMENT RESET PASS — protected credits, payments, and migration history unchanged.");
} catch (error) {
  console.error(`Recruitment reset failed: ${error.message || error}`);
  process.exitCode = 1;
}
