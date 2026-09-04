// Read-only clean-start integrity check. This never reads Sheets and never
// writes, migrates, reconciles, or touches credit/payment tables.
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("BLOCKED — DATABASE_URL is not configured");
  process.exit(2);
}

const sql = neon(databaseUrl);
const expectedTables = [
  "departments", "users", "roles", "role_status_history", "applicants", "applicant_aliases", "resume_files", "applications",
  "screening_results", "screening_invitations", "bulk_screening_queue_items", "interview_slots", "voice_call_attempts",
  "voice_interview_results", "voice_call_logs", "booking_tokens", "application_status_history",
];
const tables = await sql`select tablename from pg_tables where schemaname = 'public' and tablename = any(${expectedTables})`;
const foreignKeys = await sql`select count(*)::int as count from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace`;

const checks = [
  ["role_status_history.role_id", sql`select count(*)::int as count from role_status_history h left join roles r on r.id = h.role_id where r.id is null`],
  ["applicant_aliases.applicant_id", sql`select count(*)::int as count from applicant_aliases a left join applicants p on p.id = a.applicant_id where p.id is null`],
  ["applications.applicant_id", sql`select count(*)::int as count from applications a left join applicants p on p.id = a.applicant_id where p.id is null`],
  ["applications.role_id", sql`select count(*)::int as count from applications a left join roles r on r.id = a.role_id where r.id is null`],
  ["applications.resume_file_id", sql`select count(*)::int as count from applications a left join resume_files f on f.id = a.resume_file_id where a.resume_file_id is not null and f.id is null`],
  ["screening_results.application_id", sql`select count(*)::int as count from screening_results s left join applications a on a.id = s.application_id where a.id is null`],
  ["screening_invitations.role_id", sql`select count(*)::int as count from screening_invitations i left join roles r on r.id = i.role_id where r.id is null`],
  ["screening_invitations.application_id", sql`select count(*)::int as count from screening_invitations i left join applications a on a.id = i.application_id where i.application_id is not null and a.id is null`],
  ["bulk_screening_queue_items.role_id", sql`select count(*)::int as count from bulk_screening_queue_items q left join roles r on r.id = q.role_id where r.id is null`],
  ["bulk_screening_queue_items.application_id", sql`select count(*)::int as count from bulk_screening_queue_items q left join applications a on a.id = q.application_id where q.application_id is not null and a.id is null`],
  ["interview_slots.role_id", sql`select count(*)::int as count from interview_slots s left join roles r on r.id = s.role_id where s.role_id is not null and r.id is null`],
  ["interview_slots.application_id", sql`select count(*)::int as count from interview_slots s left join applications a on a.id = s.application_id where s.application_id is not null and a.id is null`],
  ["voice_call_attempts.application_id", sql`select count(*)::int as count from voice_call_attempts v left join applications a on a.id = v.application_id where a.id is null`],
  ["voice_interview_results.application_id", sql`select count(*)::int as count from voice_interview_results v left join applications a on a.id = v.application_id where a.id is null`],
  ["voice_interview_results.attempt_id", sql`select count(*)::int as count from voice_interview_results v left join voice_call_attempts a on a.id = v.attempt_id where v.attempt_id is not null and a.id is null`],
  ["voice_call_logs.application_id", sql`select count(*)::int as count from voice_call_logs l left join applications a on a.id = l.application_id where a.id is null`],
  ["voice_call_logs.voice_call_attempt_id", sql`select count(*)::int as count from voice_call_logs l left join voice_call_attempts a on a.id = l.voice_call_attempt_id where l.voice_call_attempt_id is not null and a.id is null`],
  ["booking_tokens.application_id", sql`select count(*)::int as count from booking_tokens b left join applications a on a.id = b.application_id where a.id is null`],
  ["application_status_history.application_id", sql`select count(*)::int as count from application_status_history h left join applications a on a.id = h.application_id where a.id is null`],
];

let orphanCount = 0;
for (const [name, query] of checks) {
  const count = Number((await query)[0]?.count || 0);
  orphanCount += count;
  console.log(`${name}: ${count === 0 ? "PASS" : "FAIL"} (${count} orphan rows)`);
}
console.log(`tables present: ${tables.length}/${expectedTables.length}`);
console.log(`foreign-key constraints: ${foreignKeys[0]?.count ?? 0}`);
const pass = tables.length === expectedTables.length && orphanCount === 0;
console.log(`OVERALL: ${pass ? "PASS" : "FAIL"}`);
process.exit(pass ? 0 : 1);
