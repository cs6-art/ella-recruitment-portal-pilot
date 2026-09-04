// Seed three synthetic Ella pilot/UAT recruitment scenarios.
// SAFE BY DEFAULT: requires --confirm-pilot-seed and an empty pilot recruitment
// database. Credits/payments and Google Sheets are deliberately untouched.

import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";

if (!process.argv.includes("--confirm-pilot-seed")) {
  console.error("Refusing dummy seed. Re-run with --confirm-pilot-seed after reviewing the synthetic dataset.");
  process.exit(2);
}
const rawUrl = process.env.DATABASE_URL?.trim();
if (!rawUrl) { console.error("BLOCKED — DATABASE_URL is not configured."); process.exit(2); }
const url = new URL(rawUrl);
if (!url.hostname.toLowerCase().includes("weathered-haze-aukfuaij") || url.pathname !== "/neondb") {
  console.error("BLOCKED — DATABASE_URL is not the confirmed Ella pilot main database.");
  process.exit(2);
}

const recruitmentTables = ["departments", "users", "oauth_connections", "portal_settings", "roles", "role_status_history", "applicants", "applicant_aliases", "resume_files", "applications", "screening_results", "screening_invitations", "bulk_screening_queue_items", "interview_slots", "voice_call_attempts", "voice_interview_results", "voice_call_logs", "booking_tokens", "application_status_history"];
const sql = neon(rawUrl);
const countRows = async (table) => Number((await sql.query(`select count(*)::int as count from "${table}"`, []))[0].count);
const protectedSnapshot = async () => (await sql`select
  (select count(*)::int from credit_ledger) as ledger_rows,
  (select coalesce(sum(credits_delta), 0) as ledger_sum from credit_ledger),
  (select count(*)::int from payments) as payment_rows,
  (select count(*)::int from payment_events) as payment_event_rows`)[0];

const departmentId = crypto.randomUUID();
const userAdminId = crypto.randomUUID();
const userHrId = crypto.randomUUID();
const roleIds = { A: crypto.randomUUID(), B: crypto.randomUUID(), C: crypto.randomUUID() };
const applicantIds = { A: crypto.randomUUID(), B: crypto.randomUUID(), C: crypto.randomUUID() };
const applicationIds = { A: crypto.randomUUID(), B: crypto.randomUUID(), C: crypto.randomUUID() };
const attemptA = crypto.randomUUID();
const attemptB1 = crypto.randomUUID();
const attemptB2 = crypto.randomUUID();
const now = new Date();
const future = (minutes) => new Date(now.getTime() + minutes * 60_000).toISOString();
const past = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

const before = Object.fromEntries(await Promise.all(recruitmentTables.map(async (table) => [table, await countRows(table)])));
if (Object.values(before).some((count) => count !== 0)) {
  console.error(JSON.stringify({ target: "pilot-main", before }, null, 2));
  console.error("BLOCKED — recruitment tables are not empty. Run the guarded reset first if approved.");
  process.exit(2);
}
const protectedBefore = await protectedSnapshot();

const statements = [
  sql.query("insert into departments (id,name,name_key) values ($1,$2,$3)", [departmentId, "Pilot UAT Operations", "pilot uat operations"]),
  sql.query("insert into users (id,email,full_name,access_role,department_id,can_create_role,can_review_role,can_approve_role,can_edit_settings,can_manage_users,can_review_department_role) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [userAdminId, "pilot.admin@example.invalid", "Pilot Admin", "Admin", departmentId, true, true, true, true, true, true]),
  sql.query("insert into users (id,email,full_name,access_role,department_id,can_create_role,can_review_role,can_approve_role,can_edit_settings,can_manage_users,can_review_department_role) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [userHrId, "pilot.hr@example.invalid", "Pilot HR", "HR", departmentId, true, true, true, false, false, false]),
  sql.query("insert into roles (id,external_id,code,title,department_id,department_snapshot,request_type,vacancies,status,recruitment_setup_status,requester_user_id,requester_email,requester_name,submitted_by_email,source,application_link,posting_confirmed,approved_by,approved_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)", [roleIds.A, "PILOT-DUMMY-A", "DUMMY-A", "Pilot QA Engineer", departmentId, "Pilot UAT Operations", "staff_addition", 1, "job_posted", "published", userHrId, "pilot.hr@example.invalid", "Pilot HR", "pilot.hr@example.invalid", "pilot-dummy", "https://pilot.invalid/jobs/dummy-a", true, "pilot.hr@example.invalid", now.toISOString()]),
  sql.query("insert into roles (id,external_id,code,title,department_id,department_snapshot,request_type,vacancies,status,recruitment_setup_status,requester_user_id,requester_email,requester_name,submitted_by_email,source,application_link,posting_confirmed,approved_by,approved_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)", [roleIds.B, "PILOT-DUMMY-B", "DUMMY-B", "Pilot Voice Support", departmentId, "Pilot UAT Operations", "staff_addition", 1, "job_posted", "published", userHrId, "pilot.hr@example.invalid", "Pilot HR", "pilot.hr@example.invalid", "pilot-dummy", "https://pilot.invalid/jobs/dummy-b", true, "pilot.hr@example.invalid", now.toISOString()]),
  sql.query("insert into roles (id,external_id,code,title,department_id,department_snapshot,request_type,vacancies,status,recruitment_setup_status,requester_user_id,requester_email,requester_name,submitted_by_email,source,application_link,posting_confirmed,approved_by,approved_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)", [roleIds.C, "PILOT-DUMMY-C", "DUMMY-C", "Pilot Bulk Screening Analyst", departmentId, "Pilot UAT Operations", "staff_addition", 1, "job_posted", "published", userHrId, "pilot.hr@example.invalid", "Pilot HR", "pilot.hr@example.invalid", "pilot-dummy", "https://pilot.invalid/jobs/dummy-c", true, "pilot.hr@example.invalid", now.toISOString()]),
  ...["A", "B", "C"].map((key) => sql.query("insert into role_status_history (role_id,changed_by_name,changed_by_email,previous_status,new_status,comments,action,action_source,action_request_id,access_role,department,notification_status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [roleIds[key], "Pilot HR", "pilot.hr@example.invalid", "draft", "job_posted", `Synthetic scenario ${key}`, "pilot_seed", "pilot_seed", `pilot-role-${key}`, "HR", "Pilot UAT Operations", "not_configured"])),
  sql.query("insert into applicants (id,primary_email,full_name,phone_e164,country,first_seen_at) values ($1,$2,$3,$4,$5,$6)", [applicantIds.A, "ava.normal@example.invalid", "Ava Normal", "+6500000001", "SG", now.toISOString()]),
  sql.query("insert into applicants (id,primary_email,full_name,phone_e164,country,first_seen_at) values ($1,$2,$3,$4,$5,$6)", [applicantIds.B, "ben.retry@example.invalid", "Ben Retry", "+6500000002", "SG", now.toISOString()]),
  sql.query("insert into applicants (id,primary_email,full_name,phone_e164,country,first_seen_at) values ($1,$2,$3,$4,$5,$6)", [applicantIds.C, "cyra.bulk@example.invalid", "Cyra Bulk", "+6500000003", "SG", now.toISOString()]),
  sql.query("insert into applications (id,external_id,applicant_id,role_id,source,source_detail,applied_at,current_stage,candidate_name,email,phone,preferred_mobile,applicant_country,resume_hr_decision,voice_hr_decision,final_hr_decision,legacy_status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)", [applicationIds.A, "PILOT-DUMMY-APP-A", applicantIds.A, roleIds.A, "direct", "pilot seed", now.toISOString(), "passed_final", "Ava Normal", "ava.normal@example.invalid", "+6500000001", "+6500000001", "SG", "approve", "approve", "approve", JSON.stringify({ scenario: "normal_success" })]),
  sql.query("insert into applications (id,external_id,applicant_id,role_id,source,source_detail,applied_at,current_stage,candidate_name,email,phone,preferred_mobile,applicant_country,resume_hr_decision,voice_hr_decision,legacy_status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)", [applicationIds.B, "PILOT-DUMMY-APP-B", applicantIds.B, roleIds.B, "referral", "pilot seed", now.toISOString(), "voice_review_pending", "Ben Retry", "ben.retry@example.invalid", "+6500000002", "+6500000002", "SG", "approve", "pending", JSON.stringify({ scenario: "no_show_retry" })]),
  sql.query("insert into applications (id,external_id,applicant_id,role_id,source,source_detail,applied_at,current_stage,candidate_name,email,phone,preferred_mobile,applicant_country,resume_hr_decision,legacy_status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)", [applicationIds.C, "PILOT-DUMMY-APP-C", applicantIds.C, roleIds.C, "drive_import", "pilot seed", now.toISOString(), "resume_approved", "Cyra Bulk", "cyra.bulk@example.invalid", "+6500000003", "+6500000003", "SG", "approve", JSON.stringify({ scenario: "bulk_drive", creditDeductionExpected: 1 })]),
  sql.query("insert into screening_results (application_id,match_score,recommendation,summary,strengths,gaps,interview_questions,screened_at,raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [applicationIds.A, 94, "strong_yes", "Synthetic successful screening", "QA and testing", "None", "Tell us about test strategy", now.toISOString(), JSON.stringify({ scenario: "normal_success" })]),
  sql.query("insert into screening_results (application_id,match_score,recommendation,summary,screened_at,raw) values ($1,$2,$3,$4,$5,$6)", [applicationIds.B, 72, "review", "Synthetic retry screening", now.toISOString(), JSON.stringify({ scenario: "no_show_retry" })]),
  sql.query("insert into screening_results (application_id,match_score,recommendation,summary,screened_at,raw) values ($1,$2,$3,$4,$5,$6)", [applicationIds.C, 86, "yes", "Synthetic bulk screening", now.toISOString(), JSON.stringify({ scenario: "bulk_drive", creditDeductionExpected: 1 })]),
  sql.query("insert into voice_call_attempts (id,application_id,role_id,attempt_number,max_attempts,scheduled_at,status,outcome,preferred_mobile,contact_number,applicant_country,provider_call_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [attemptA, applicationIds.A, roleIds.A, 1, 3, past(30), "completed", "completed", "+6500000001", "+6500000001", "SG", "pilot-call-a"]),
  sql.query("insert into voice_call_attempts (id,application_id,role_id,attempt_number,max_attempts,scheduled_at,status,outcome,preferred_mobile,contact_number,applicant_country,provider_call_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [attemptB1, applicationIds.B, roleIds.B, 1, 3, past(20), "no_show", "no_show", "+6500000002", "+6500000002", "SG", "pilot-call-b1"]),
  sql.query("insert into voice_call_attempts (id,application_id,role_id,attempt_number,max_attempts,scheduled_at,retry_after,status,preferred_mobile,contact_number,applicant_country,provider_call_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [attemptB2, applicationIds.B, roleIds.B, 2, 3, future(30), future(15), "retry_scheduled", "+6500000002", "+6500000002", "SG", "pilot-call-b2"]),
  sql.query("insert into voice_interview_results (application_id,attempt_id,score,recommendation,strengths,summary,transcript,call_status,call_final_status,provider_event_type,result_received_at,call_completed_at,raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [applicationIds.A, attemptA, 91, "recommend", "Clear communication", "Synthetic successful voice result", "Synthetic transcript", "completed", "completed", "pilot.voice.completed", now.toISOString(), past(10), JSON.stringify({ scenario: "normal_success" })]),
  sql.query("insert into voice_call_logs (application_id,voice_call_attempt_id,provider,provider_call_id,provider_event_id,source_event_key,call_status,duration_seconds,recording_url,communication_score,completeness_score,follow_up_questions,transcript,summary,recommendation,raw_result,started_at,ended_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)", [applicationIds.A, attemptA, "pilot-provider", "pilot-call-a", "pilot-event-a", "pilot-seed-voice-a", "completed", 420, "https://pilot.invalid/recordings/a", 91, 90, "", "Synthetic transcript", "Synthetic successful voice result", "recommend", JSON.stringify({ scenario: "normal_success" }), past(17), past(10)]),
  sql.query("insert into interview_slots (slot_code,interview_type,role_id,starts_at,ends_at,timezone,status,application_id,candidate_name,candidate_email,booked_at,interviewer_name,interviewer_email) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", ["PILOT-DUMMY-FINAL-A", "final", roleIds.A, future(120), future(180), "Asia/Singapore", "booked", applicationIds.A, "Ava Normal", "ava.normal@example.invalid", now.toISOString(), "Pilot Interviewer", "pilot.hr@example.invalid"]),
  sql.query("insert into interview_slots (slot_code,interview_type,role_id,starts_at,ends_at,timezone,status,application_id,candidate_name,candidate_email) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", ["PILOT-DUMMY-VOICE-B", "voice", roleIds.B, past(20), past(10), "Asia/Singapore", "no_show", applicationIds.B, "Ben Retry", "ben.retry@example.invalid"]),
  sql.query("insert into bulk_screening_queue_items (batch_id,role_id,dedupe_key,resume_sha256,drive_file_id,filename,file_url,mime_type,status,application_id,candidate_name,candidate_email,preferred_mobile,applicant_country,attempt_count,source,environment,is_uat,job_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)", ["PILOT-DUMMY-BATCH-C", roleIds.C, "PILOT-DUMMY-C:" + hash("cyra-bulk-resume"), hash("cyra-bulk-resume"), "pilot-dummy-drive-c", "cyra-bulk-resume.pdf", "https://pilot.invalid/drive/c", "application/pdf", "screened", applicationIds.C, "Cyra Bulk", "cyra.bulk@example.invalid", "+6500000003", "SG", 1, "drive", "pilot", true, "PILOT-DUMMY-C"]),
  sql.query("insert into booking_tokens (application_id,kind,token_hash,status,expires_at,link) values ($1,$2,$3,$4,$5,$6)", [applicationIds.A, "final", hash("pilot-final-token-a"), "booked", future(1440), "https://pilot.invalid/book/final/a"]),
  ...["A", "B", "C"].map((key) => sql.query("insert into application_status_history (application_id,stage,previous_stage,new_stage,decision,actor_name,actor_email,comments,source,action_request_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [applicationIds[key], key === "A" ? "final" : key === "B" ? "voice" : "screening", "resume_review", key === "A" ? "passed_final" : key === "B" ? "voice_review_pending" : "resume_approved", "pilot_seed", "Pilot HR", "pilot.hr@example.invalid", `Synthetic scenario ${key}`, "pilot_seed", `pilot-app-${key}`])),
];

try {
  await sql.transaction(statements);
  const after = Object.fromEntries(await Promise.all(recruitmentTables.map(async (table) => [table, await countRows(table)])));
  const protectedAfter = await protectedSnapshot();
  console.log(JSON.stringify({ target: "pilot-main", scenarios: { A: "normal_success", B: "no_show_retry", C: "bulk_drive" }, after, protectedBefore, protectedAfter }, null, 2));
  if (JSON.stringify(protectedBefore) !== JSON.stringify(protectedAfter)) throw new Error("protected credit/payment state changed");
  console.log("PILOT DUMMY SEED PASS — synthetic recruitment data only; credit deduction intentionally not performed.");
} catch (error) {
  console.error(`Dummy seed failed: ${error.message || error}`);
  process.exitCode = 1;
}
