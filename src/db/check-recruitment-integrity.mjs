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
  "organizations", "organization_memberships",
  "departments", "users", "roles", "role_status_history", "applicants", "applicant_aliases", "resume_files", "applications",
  "screening_results", "screening_invitations", "bulk_screening_queue_items", "interview_slots", "voice_call_attempts",
  "voice_interview_results", "voice_call_logs", "booking_tokens", "application_status_history",
];
const tables = await sql`select tablename from pg_tables where schemaname = 'public' and tablename = any(${expectedTables})`;
const foreignKeys = await sql`select count(*)::int as count from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace`;

const checks = [
  ["organization_memberships.organization_id", sql`select count(*)::int as count from organization_memberships m left join organizations o on o.id = m.organization_id where o.id is null`],
  ["recruitment.organization_id", sql`select count(*)::int as count from (
    select organization_id from departments
    union all select organization_id from users
    union all select organization_id from oauth_connections
    union all select organization_id from portal_settings
    union all select organization_id from roles
    union all select organization_id from role_status_history
    union all select organization_id from applicants
    union all select organization_id from applicant_aliases
    union all select organization_id from resume_files
    union all select organization_id from applications
    union all select organization_id from screening_results
    union all select organization_id from screening_invitations
    union all select organization_id from bulk_screening_queue_items
    union all select organization_id from interview_slots
    union all select organization_id from voice_call_attempts
    union all select organization_id from voice_interview_results
    union all select organization_id from voice_call_logs
    union all select organization_id from booking_tokens
    union all select organization_id from application_status_history
  ) entities left join organizations o on o.id = entities.organization_id where o.id is null`],
  ["users.department_id", sql`select count(*)::int as count from users u join departments d on d.id = u.department_id where d.organization_id <> u.organization_id`],
  ["roles.organization_id", sql`select count(*)::int as count from roles r left join organizations o on o.id = r.organization_id where o.id is null`],
  ["roles.department_id", sql`select count(*)::int as count from roles r join departments d on d.id = r.department_id where d.organization_id <> r.organization_id`],
  ["role_status_history.role_id", sql`select count(*)::int as count from role_status_history h left join roles r on r.id = h.role_id where r.id is null`],
  ["role_status_history.organization_id", sql`select count(*)::int as count from role_status_history h join roles r on r.id = h.role_id where h.organization_id <> r.organization_id`],
  ["applicant_aliases.applicant_id", sql`select count(*)::int as count from applicant_aliases a left join applicants p on p.id = a.applicant_id where p.id is null`],
  ["applicant_aliases.organization_id", sql`select count(*)::int as count from applicant_aliases x join applicants a on a.id = x.applicant_id where x.organization_id <> a.organization_id`],
  ["applications.applicant_id", sql`select count(*)::int as count from applications a left join applicants p on p.id = a.applicant_id where p.id is null`],
  ["applications.role_id", sql`select count(*)::int as count from applications a left join roles r on r.id = a.role_id where r.id is null`],
  ["applications.organization_id", sql`select count(*)::int as count from applications a left join organizations o on o.id = a.organization_id where o.id is null`],
  ["applications.applicant_tenant", sql`select count(*)::int as count from applications a join applicants p on p.id = a.applicant_id where a.organization_id <> p.organization_id`],
  ["applications.role_tenant", sql`select count(*)::int as count from applications a join roles r on r.id = a.role_id where a.organization_id <> r.organization_id`],
  ["applications.resume_file_id", sql`select count(*)::int as count from applications a left join resume_files f on f.id = a.resume_file_id where a.resume_file_id is not null and f.id is null`],
  ["applications.resume_tenant", sql`select count(*)::int as count from applications a join resume_files f on f.id = a.resume_file_id where a.organization_id <> f.organization_id`],
  ["screening_results.application_id", sql`select count(*)::int as count from screening_results s left join applications a on a.id = s.application_id where a.id is null`],
  ["screening_results.organization_id", sql`select count(*)::int as count from screening_results s join applications a on a.id = s.application_id where s.organization_id <> a.organization_id`],
  ["screening_invitations.role_id", sql`select count(*)::int as count from screening_invitations i left join roles r on r.id = i.role_id where r.id is null`],
  ["screening_invitations.application_id", sql`select count(*)::int as count from screening_invitations i left join applications a on a.id = i.application_id where i.application_id is not null and a.id is null`],
  ["screening_invitations.organization_id", sql`select count(*)::int as count from screening_invitations i join roles r on r.id = i.role_id where i.organization_id <> r.organization_id`],
  ["bulk_screening_queue_items.role_id", sql`select count(*)::int as count from bulk_screening_queue_items q left join roles r on r.id = q.role_id where r.id is null`],
  ["bulk_screening_queue_items.application_id", sql`select count(*)::int as count from bulk_screening_queue_items q left join applications a on a.id = q.application_id where q.application_id is not null and a.id is null`],
  ["bulk_screening_queue_items.organization_id", sql`select count(*)::int as count from bulk_screening_queue_items q join roles r on r.id = q.role_id where q.organization_id <> r.organization_id`],
  ["interview_slots.role_id", sql`select count(*)::int as count from interview_slots s left join roles r on r.id = s.role_id where s.role_id is not null and r.id is null`],
  ["interview_slots.application_id", sql`select count(*)::int as count from interview_slots s left join applications a on a.id = s.application_id where s.application_id is not null and a.id is null`],
  ["interview_slots.organization_id", sql`select count(*)::int as count from interview_slots s left join roles r on r.id = s.role_id left join applications a on a.id = s.application_id where (r.id is not null and s.organization_id <> r.organization_id) or (a.id is not null and s.organization_id <> a.organization_id)`],
  ["voice_call_attempts.application_id", sql`select count(*)::int as count from voice_call_attempts v left join applications a on a.id = v.application_id where a.id is null`],
  ["voice_call_attempts.organization_id", sql`select count(*)::int as count from voice_call_attempts v join applications a on a.id = v.application_id where v.organization_id <> a.organization_id`],
  ["voice_interview_results.application_id", sql`select count(*)::int as count from voice_interview_results v left join applications a on a.id = v.application_id where a.id is null`],
  ["voice_interview_results.attempt_id", sql`select count(*)::int as count from voice_interview_results v left join voice_call_attempts a on a.id = v.attempt_id where v.attempt_id is not null and a.id is null`],
  ["voice_interview_results.organization_id", sql`select count(*)::int as count from voice_interview_results v join applications a on a.id = v.application_id where v.organization_id <> a.organization_id`],
  ["voice_call_logs.application_id", sql`select count(*)::int as count from voice_call_logs l left join applications a on a.id = l.application_id where a.id is null`],
  ["voice_call_logs.voice_call_attempt_id", sql`select count(*)::int as count from voice_call_logs l left join voice_call_attempts a on a.id = l.voice_call_attempt_id where l.voice_call_attempt_id is not null and a.id is null`],
  ["voice_call_logs.organization_id", sql`select count(*)::int as count from voice_call_logs l join applications a on a.id = l.application_id where l.organization_id <> a.organization_id`],
  ["booking_tokens.application_id", sql`select count(*)::int as count from booking_tokens b left join applications a on a.id = b.application_id where a.id is null`],
  ["booking_tokens.organization_id", sql`select count(*)::int as count from booking_tokens b join applications a on a.id = b.application_id where b.organization_id <> a.organization_id`],
  ["application_status_history.application_id", sql`select count(*)::int as count from application_status_history h left join applications a on a.id = h.application_id where a.id is null`],
  ["application_status_history.organization_id", sql`select count(*)::int as count from application_status_history h join applications a on a.id = h.application_id where h.organization_id <> a.organization_id`],
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
