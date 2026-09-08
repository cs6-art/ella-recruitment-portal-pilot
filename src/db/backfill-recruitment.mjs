// Sheets -> Postgres recruitment backfill.
// SAFE BY DEFAULT: dry-run unless --commit is passed.
// The pilot has two source workbooks: role/config tabs use the roles workbook;
// applicant and operational tabs use the main workbook. Never collapse them.
//
// Examples:
//   npm run db:backfill:recruitment -- --only=roles,applicants,applications
//   npm run db:backfill:recruitment -- --only=all
//   npm run db:backfill:recruitment -- --only=roles --commit

import crypto from "node:crypto";
import { google } from "googleapis";
import { neon } from "@neondatabase/serverless";

const args = new Set(process.argv.slice(2));
const commit = args.has("--commit");
const onlyArg = [...args].find((a) => a.startsWith("--only="));
const requested = onlyArg ? onlyArg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean) : ["roles", "applicants", "applications"];
const databaseUrl = process.env.DATABASE_URL?.trim();
const mainSpreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
const rolesSpreadsheetId = process.env.GOOGLE_CANDIDATE_SPREADSHEET_ID?.trim();
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/^"(.*)"$/s, "$1").replace(/\\n/g, "\n").trim();
for (const [name, value] of Object.entries({ DATABASE_URL: databaseUrl, GOOGLE_SHEETS_SPREADSHEET_ID: mainSpreadsheetId, GOOGLE_CANDIDATE_SPREADSHEET_ID: rolesSpreadsheetId, GOOGLE_SERVICE_ACCOUNT_EMAIL: serviceAccountEmail, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey })) {
  if (!value) { console.error(`BLOCKED — ${name} is not set.`); process.exit(2); }
}
const sql = neon(databaseUrl);
const dbQuery = sql.query.bind(sql);
if (!commit) sql.query = async (query, params) => /^\s*select\s+1\s+from\s+/i.test(query) ? [] : dbQuery(query, params);
const auth = new google.auth.JWT({ email: serviceAccountEmail, key: privateKey, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
const sheets = google.sheets({ version: "v4", auth });
const WORKBOOKS = { main: mainSpreadsheetId, roles: rolesSpreadsheetId };
const DOMAINS = ["departments", "users", "roles", "historical_placeholders", "role_history", "applicants", "applicant_aliases", "resume_files", "applications", "application_history", "screening_results", "screening_invitations", "bulk_queue", "interview_slots", "voice_attempts", "voice_results", "voice_logs", "final_interview", "booking_tokens", "portal_settings"];
const wanted = new Set(requested.includes("all") ? DOMAINS : requested);
const text = (v) => (v === undefined || v === null ? "" : String(v).trim());
const lower = (v) => text(v).toLowerCase();
const iso = (v) => { const t = Date.parse(text(v)); return Number.isFinite(t) ? new Date(Math.min(t, Date.now())).toISOString() : new Date(0).toISOString(); };
const stableUuid = (value) => { const h = crypto.createHash("sha256").update(String(value)).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")}${h.slice(18, 20)}-${h.slice(20, 32)}`; };
const json = (v, fallback = {}) => { try { return JSON.stringify(v ?? fallback); } catch { return JSON.stringify(fallback); } };
const report = {};
const errors = [];
const dryRoleExternalIds = new Set();
const plannedApplicants = new Map();
const plannedApplications = new Map();
const DB_SETTING_KEYS = new Set(["Booking_Default_Timezone", "Final_Interview_Calendar_Email", "Final_Interview_Calendar_ID", "Voice_Interview_Duration_Minutes", "Final_Interview_Duration_Minutes", "Booking_Link_Expiry_Days", "Require_Resume_HR_Approval", "Require_Voice_HR_Approval", "Booking_Invitation_Auto_Send", "Voice_Call_Max_Attempts", "Voice_Call_Retry_Gap_Hours", "Ella_Credit_Cost_CV_Analysis", "Ella_Credit_Cost_Phone_Interview", "Ella_Credit_Discount_Threshold", "Ella_Credit_Discount_Percent"]);
function counts(domain) { return report[domain] ??= { discovered: 0, valid: 0, proposed: 0, skipped: 0, duplicates: 0, rejected: 0, unmapped: 0, fkFailures: 0, identityCollisions: 0, manualReview: 0, destinationPending: 0 }; }
function tally(domain, key, n = 1) { counts(domain)[key] += n; }

async function readTab(workbook, tab) {
  const spreadsheetId = WORKBOOKS[workbook];
  const range = `'${tab.replaceAll("'", "''")}'!A:ZZ`;
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const values = res.data.values ?? [];
    const headers = (values[0] ?? []).map(text);
    const rows = values.slice(1).filter((r) => r.some((c) => text(c) !== "")).map((r) => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = r[i]; });
      return obj;
    });
    return { workbook, tab, range, headers, rows };
  } catch (error) {
    const message = error?.message ?? String(error);
    errors.push({ workbook, tab, range, message });
    throw new Error(`${workbook}/${tab} ${range}: ${message}`);
  }
}
async function existingSet(table, column) { return new Set((await sql.query(`select "${column}" as value from "${table}" where "${column}" is not null`, [])).map((r) => text(r.value))); }
async function existingMap(table, key, value) { return new Map((await sql.query(`select "${key}" as key, "${value}" as value from "${table}"`, [])).map((r) => [text(r.key), r.value])); }
async function roleMap() { return existingMap("roles", "external_id", "id"); }
async function maybeFind(query, params) { return commit ? sql.query(query, params) : []; }
async function insertOrSkip(domain, exists, insert) { if (exists) { tally(domain, "skipped"); return false; } tally(domain, "proposed"); if (commit) await insert(); return true; }

function roleStatus(raw) { const s = lower(raw); if (s.includes("approv")) return "approved"; if (s.includes("posted")) return "job_posted"; if (s.includes("setup")) return "recruitment_setup"; if (s.includes("reject")) return "rejected"; if (s.includes("hold")) return "on_hold"; if (s.includes("return")) return "returned_for_revision"; if (s.includes("hr")) return "pending_hr_discussion"; return "draft"; }
function sourceType(r) { const s = lower(r.Source || r.Application_Source); if (s.includes("invitation")) return "hr_invitation"; if (s.includes("bulk")) return "bulk_upload"; if (s.includes("drive")) return "drive_import"; if (s.includes("onedrive")) return "onedrive_import"; if (String(r["Application ID"] || r.Application_ID).startsWith("APP-BULK")) return "bulk_upload"; return "direct"; }
function stage(r) { const final = lower(r.Final_Status || r["Status 3 (Final Interview)"]); if (final.includes("reject")) return "rejected"; if (final.includes("pass")) return "passed_final"; if (final.includes("final")) return "approved_for_final"; if (lower(r["Status 2 (Voice Interview)"]).includes("voice")) return "voice_review_pending"; if (lower(r.Voice_Interview_Booking_Status).includes("booked")) return "voice_scheduled"; if (lower(r.Resume_HR_Decision) === "approve") return "resume_approved"; return "resume_review"; }
function decision(raw) { const s = lower(raw); return ["approve", "reject", "manual_review", "pending"].includes(s) ? s : ""; }
function statusJson(r) { return Object.fromEntries(Object.entries(r).filter(([k, v]) => /status|decision|booking/i.test(k) && text(v)).map(([k, v]) => [k, text(v)])); }

async function backfillDepartments(rows) {
  if (!wanted.has("departments") && !wanted.has("roles")) return;
  const names = new Map(); for (const r of rows) { const name = text(r.Department); if (name) names.set(lower(name), name); }
  for (const [key, name] of names) { tally("departments", "discovered"); tally("departments", "valid"); const [found] = await maybeFind("select id from departments where name_key=$1 limit 1", [key]); await insertOrSkip("departments", !!found, () => sql.query("insert into departments (name,name_key) values ($1,$2) on conflict (name_key) do nothing", [name, key])); }
}

async function backfillRoles() {
  const source = await readTab("roles", "Role_Requests"); console.log(`TAB roles: ${source.workbook}/${source.tab} ${source.range} — ${source.rows.length} rows`); await backfillDepartments(source.rows); const seen = new Set();
  for (const r of source.rows) { tally("roles", "discovered"); const externalId = text(r.Role_ID || r.Submission_ID); if (!externalId) { tally("roles", "rejected"); continue; } if (seen.has(externalId)) { tally("roles", "duplicates"); continue; } seen.add(externalId); dryRoleExternalIds.add(externalId); tally("roles", "valid"); const [found] = await maybeFind("select id from roles where external_id=$1 limit 1", [externalId]); const dept = lower(r.Department); const [department] = dept ? await maybeFind("select id from departments where name_key=$1 limit 1", [dept]) : []; if (commit && dept && !department) { tally("roles", "fkFailures"); continue; }
    await insertOrSkip("roles", !!found, () => sql.query(`insert into roles (external_id,code,title,department_id,department_snapshot,request_type,vacancies,reason,target_hiring_date,status,recruitment_setup_status,requester_email,requester_name,submitted_by_email,hr_calendar_email,application_link,posted_at,posted_by,posting_confirmed,latest_comments,approved_by,approved_at,setup,evaluation_fields,availability_rules,archive,source,created_at,updated_by_email) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29) on conflict (external_id) do nothing`, [externalId, text(r.Code) || null, text(r.Job_Title), department?.id ?? null, text(r.Department), text(r.Request_Type), Number(r.Number_Of_Vacancies) || 1, text(r.Reason_For_Request), text(r.Target_Hiring_Date) || null, roleStatus(r.Status), text(r.Recruitment_Setup_Status) === "Published" ? "published" : text(r.Recruitment_Setup_Status).toLowerCase().replaceAll(" ", "_") || "draft", lower(r.Requester_Email), text(r.Requester_Name), lower(r.Submitted_By_Email), text(r.HOD_Email), text(r.Application_Link), text(r.Posted_At) || null, text(r.Posted_By), lower(r.Posting_Confirmed) === "true", text(r.Latest_Comments), text(r.Approved_By), text(r.Approved_At) || null, json({ jobDescription: r.Job_Description, screeningCriteria: r.Screening_Criteria, systemPrompt: r.VAPI_Resolved_System_Prompt || r.AI_System_Prompt }), json(text(r.Evaluation_Fields) ? [text(r.Evaluation_Fields)] : []), json(text(r.Interview_Availability_Rules) ? [text(r.Interview_Availability_Rules)] : []), json({ managementComments: r.Management_Comments }), text(r.Source || "sheet-backfill"), iso(r.Created_At), lower(r.Submitted_By_Email)]));
  }
}

async function auditHistoricalPlaceholders() {
  if (!wanted.has("historical_placeholders")) return;
  const current = new Set((await readTab("roles", "Role_Requests")).rows.map((r) => text(r.Role_ID || r.Submission_ID)).filter(Boolean));
  const refs = new Set();
  for (const [workbook, tab, field] of [["main", "High_Match_Profile", "Role_ID"], ["main", "Interview_Slots", "Role_ID"], ["main", "Voice_Call_Queue", "Role_ID"], ["main", "Voice_Interview_Results", "Role_ID"], ["roles", "Role_Status_History", "Role_ID"]]) {
    for (const r of (await readTab(workbook, tab)).rows) { const id = text(r[field]); if (id && !current.has(id)) refs.add(id); }
  }
  for (const externalId of ["IS01", "UUD03"]) {
    if (!refs.has(externalId)) continue;
    tally("historical_placeholders", "discovered"); tally("historical_placeholders", "valid"); tally("historical_placeholders", "manualReview");
  }
}

async function backfillApplicantsAndApplications() {
  const source = await readTab("main", "High_Match_Profile"); console.log(`TAB applications: ${source.workbook}/${source.tab} ${source.range} — ${source.rows.length} rows`); const roles = await roleMap(); const applicants = await existingSet("applicants", "primary_email"); const applications = await existingSet("applications", "external_id"); const seenApplications = new Set(); const seenIdentity = new Map();
  for (const r of source.rows) { const email = lower(r.Email || r.email); const appExternalId = text(r["Application ID"] || r.Application_ID); const roleExternalId = text(r.Role_ID); tally("applications", "discovered"); if (!appExternalId || !email) { tally("applications", "rejected"); continue; } if (seenApplications.has(appExternalId)) { tally("applications", "duplicates"); continue; } seenApplications.add(appExternalId); tally("applications", "valid"); if (seenIdentity.has(appExternalId) && seenIdentity.get(appExternalId) !== email) tally("applications", "identityCollisions"); seenIdentity.set(appExternalId, email);
    const applicantId = plannedApplicants.get(email) || (commit ? (await sql.query("select id from applicants where primary_email=$1 limit 1", [email]))[0]?.id : null) || stableUuid(`applicant:${email}`);
    tally("applicants", "discovered"); if (applicants.has(email)) { plannedApplicants.set(email, applicantId); tally("applicants", "skipped"); } else { tally("applicants", "valid"); plannedApplicants.set(email, applicantId); await insertOrSkip("applicants", false, () => sql.query("insert into applicants (id,primary_email,full_name,phone_e164,country,first_seen_at) values ($1,$2,$3,$4,$5,$6) on conflict (primary_email) do nothing", [applicantId, email, text(r["Candidate Name"]), text(r.Preferred_Mobile || r["Contact Number"]), text(r.Applicant_Country), iso(r["Date of Application"])])); applicants.add(email); }
    const roleId = roles.get(roleExternalId) || (dryRoleExternalIds.has(roleExternalId) ? `dry:${roleExternalId}` : null); if (!roleId) { tally("applications", "fkFailures"); tally("applications", "unmapped"); continue; } if (applications.has(appExternalId)) { plannedApplications.set(appExternalId, applications.get(appExternalId)); tally("applications", "skipped"); continue; } plannedApplications.set(appExternalId, stableUuid(`application:${appExternalId}`));
    if (commit && String(roleId).startsWith("dry:")) { tally("applications", "fkFailures"); continue; }
    await insertOrSkip("applications", false, () => sql.query(`insert into applications (id,external_id,applicant_id,role_id,source,source_detail,applied_at,department_snapshot,current_stage,candidate_name,email,phone,preferred_mobile,applicant_country,resume_hr_decision,voice_hr_decision,final_hr_decision,legacy_status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) on conflict (external_id) do nothing`, [plannedApplications.get(appExternalId), appExternalId, applicantId, roleId, sourceType(r), text(r.Source || r.Application_Source), iso(r["Date of Application"]), text(r.Department), stage(r), text(r["Candidate Name"]), email, text(r["Contact Number"]), text(r.Preferred_Mobile), text(r.Applicant_Country), decision(r.Resume_HR_Decision), decision(r.Voice_HR_Decision), decision(r.Final_HR_Decision), json(statusJson(r))])); applications.add(appExternalId);
  }
}

async function backfillUsers() { if (!wanted.has("users")) return; const source = await readTab("roles", "User_Directory"); const existing = await existingSet("users", "email"); const seen = new Set(); for (const r of source.rows) { tally("users", "discovered"); const email = lower(r.Email); if (!email) { tally("users", "rejected"); continue; } if (seen.has(email)) { tally("users", "duplicates"); continue; } seen.add(email); tally("users", "valid"); await insertOrSkip("users", existing.has(email), () => sql.query("insert into users (email,full_name,access_role,can_create_role,can_review_role,can_approve_role,can_edit_settings,active) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (email) do nothing", [email, text(r.Full_Name), text(r.Access_Role), lower(r.Can_Create_Role) === "true", lower(r.Can_Review_Role) === "true", lower(r.Can_Approve_Role) === "true", lower(r.Can_Edit_Settings) === "true", lower(r.Active) !== "false"])); existing.add(email); } }
async function backfillPortalSettings() { if (!wanted.has("portal_settings")) return; const source = await readTab("main", "Settings"); const existing = await existingSet("portal_settings", "key"); const seen = new Set(); for (const r of source.rows) { tally("portal_settings", "discovered"); const key = text(r.Setting_Key); if (!key || !DB_SETTING_KEYS.has(key)) { tally("portal_settings", "unmapped"); continue; } if (seen.has(key)) { tally("portal_settings", "duplicates"); continue; } seen.add(key); tally("portal_settings", "valid"); await insertOrSkip("portal_settings", existing.has(key), () => sql.query("insert into portal_settings (key,value,category,updated_at,updated_by) values ($1,$2,$3,$4,$5) on conflict (key) do nothing", [key, text(r.Setting_Value), text(r.Category), iso(r.Updated_At), text(r.Updated_By)])); existing.add(key); } }
async function backfillRoleHistory() { if (!wanted.has("role_history")) return; const source = await readTab("roles", "Role_Status_History"); const roles = await roleMap(); const seen = new Set(); for (const r of source.rows) { tally("role_history", "discovered"); const externalRole = text(r.Role_ID); const roleId = roles.get(externalRole) || (dryRoleExternalIds.has(externalRole) ? `dry:${externalRole}` : null); const key = text(r.Action_Request_ID) || text(r.History_ID) || crypto.createHash("sha256").update(json(r)).digest("hex"); if (!roleId) { tally("role_history", "fkFailures"); tally("role_history", "unmapped"); continue; } if (seen.has(key)) { tally("role_history", "duplicates"); continue; } seen.add(key); tally("role_history", "valid"); const [found] = await sql.query("select 1 from role_status_history where action_request_id=$1 limit 1", [key]); if (commit && String(roleId).startsWith("dry:")) { tally("role_history", "fkFailures"); continue; } await insertOrSkip("role_history", !!found, () => sql.query("insert into role_status_history (role_id,changed_at,changed_by_name,changed_by_email,previous_status,new_status,comments,action_source,action_request_id,action,access_role,department,notification_status,notification_error) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict do nothing", [roleId, iso(r.Changed_At), text(r.Changed_By_Name), lower(r.Changed_By_Email), text(r.Previous_Status), text(r.New_Status), text(r.Comments), text(r.Action_Source), key, text(r.Action), text(r.Access_Role), text(r.Department), text(r.Notification_Status), text(r.Notification_Error)])); } }

async function backfillApplicationsSupport() {
  const source = await readTab("main", "High_Match_Profile");
  const apps = await existingMap("applications", "external_id", "id");

  if (wanted.has("applicant_aliases")) {
    for (const r of source.rows) {
      const email = lower(r.Email);
      if (!email) continue;
      const [applicant] = commit ? await sql.query("select id from applicants where primary_email=$1", [email]) : [];
      const applicantRow = applicant || (plannedApplicants.has(email) ? { id: plannedApplicants.get(email) } : null);
      if (!applicantRow) continue;
      for (const [kind, value] of [["email", email], ["name", lower(r["Candidate Name"])], ["phone", text(r.Preferred_Mobile || r["Contact Number"])]] ) {
        if (!value) continue;
        tally("applicant_aliases", "discovered");
const [found] = await maybeFind("select 1 from applicant_aliases where kind=$1 and value=$2", [kind, value]);
        await insertOrSkip("applicant_aliases", !!found, () => sql.query("insert into applicant_aliases (applicant_id,kind,value,source,first_seen_at) values ($1,$2,$3,$4,$5) on conflict do nothing", [applicantRow.id, kind, value, "High_Match_Profile", iso(r["Date of Application"])]));
      }
    }
  }
  if (wanted.has("resume_files")) {
    for (const r of source.rows) {
      const ref = text(r.Resume_File_Id);
      if (!ref) continue;
      tally("resume_files", "discovered");
const [found] = await maybeFind("select 1 from resume_files where storage_ref=$1", [ref]);
      await insertOrSkip("resume_files", !!found, () => sql.query("insert into resume_files (storage_ref,sha256,filename,mime_type,size,kind,uploaded_at,expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing", [ref, text(r.Resume_File_SHA256), text(r.Resume_File_Name), text(r.Resume_File_Mime_Type), Number(r.Resume_File_Size) || 0, lower(text(r.Resume_File_Mime_Type)).includes("pdf") ? "pdf" : lower(text(r.Resume_File_Mime_Type)).includes("word") ? "docx" : "", iso(r["Date of Application"]), text(r.Resume_File_Expires_At) || null]));
    }
  }
  if (wanted.has("screening_results")) {
    for (const r of source.rows) {
      const app = apps.get(text(r["Application ID"] || r.Application_ID)) || plannedApplications.get(text(r["Application ID"] || r.Application_ID));
      if (!app) { tally("screening_results", "unmapped"); continue; }
      tally("screening_results", "discovered");
const [found] = await maybeFind("select 1 from screening_results where application_id=$1", [app]);
      await insertOrSkip("screening_results", !!found, () => sql.query("insert into screening_results (application_id,match_score,recommendation,summary,strengths,gaps,interview_questions,screened_at,raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing", [app, Number(r["Match Score"]) || null, text(r.Recommendation), text(r["AI Analysis Summary"]), text(r.Strengths), text(r.Gaps), text(r["Interview Questions"]), text(r.Last_Updated) || null, json(r)]));
    }
  }
  if (wanted.has("booking_tokens")) {
    for (const r of source.rows) {
      const app = apps.get(text(r["Application ID"] || r.Application_ID)) || plannedApplications.get(text(r["Application ID"] || r.Application_ID));
      for (const [kind, hash, status, created, expires, used] of [["voice", text(r.Booking_Token_Hash), text(r.Booking_Token_Status), r.Booking_Token_Created_At, r.Booking_Token_Expires_At, ""], ["final", text(r.Final_Interview_Booking_Token_Hash), text(r.Final_Interview_Booking_Token_Status), r.Final_Interview_Booking_Token_Created_At, r.Final_Interview_Booking_Token_Expires_At, r.Final_Interview_Booking_Token_Used_At]]) {
        if (!app || !hash) continue;
        tally("booking_tokens", "discovered");
const [found] = await maybeFind("select 1 from booking_tokens where token_hash=$1", [hash]);
        await insertOrSkip("booking_tokens", !!found, () => sql.query("insert into booking_tokens (application_id,kind,token_hash,status,expires_at,used_at,link,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing", [app, kind, hash, status || "pending", text(expires) || null, text(used) || null, "", iso(created)]));
      }
    }
  }
  if (wanted.has("application_history")) {
    const history = await readTab("main", "Candidate_Status_History");
    for (const r of history.rows) {
      const app = apps.get(text(r.Application_ID)) || plannedApplications.get(text(r.Application_ID));
      tally("application_history", "discovered");
      const key = text(r.Action_Request_ID) || text(r.History_ID) || crypto.createHash("sha256").update(json(r)).digest("hex");
      if (!app) { tally("application_history", "fkFailures"); tally("application_history", "unmapped"); continue; }
const [found] = await maybeFind("select 1 from application_status_history where action_request_id=$1", [key]);
      await insertOrSkip("application_history", !!found, () => sql.query("insert into application_status_history (application_id,changed_at,stage,previous_stage,new_stage,decision,actor_name,actor_email,comments,source,action_request_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing", [app, iso(r.Changed_At), text(r.Stage), text(r.Previous_Status), text(r.New_Status), text(r.Action), text(r.Changed_By_Name), lower(r.Changed_By_Email), text(r.Comments), text(r.Action_Source), key]));
    }
  }
}

async function backfillInvitations() { if (!wanted.has("screening_invitations")) return; const source = await readTab("main", "Resume_Screening_Invitations"); const roles = await roleMap(); const apps = await existingMap("applications", "external_id", "id"); for (const r of source.rows) { tally("screening_invitations", "discovered"); const role = roles.get(text(r.Role_ID)) || (dryRoleExternalIds.has(text(r.Role_ID)) ? `dry:${text(r.Role_ID)}` : null); const hash = text(r.Token_Hash); const app = apps.get(text(r.Application_ID)) || plannedApplications.get(text(r.Application_ID)) || null; if (!role || !hash) { tally("screening_invitations", "fkFailures"); tally("screening_invitations", "unmapped"); continue; } const [f] = await sql.query("select 1 from screening_invitations where token_hash=$1", [hash]); await insertOrSkip("screening_invitations", !!f, () => sql.query("insert into screening_invitations (role_id,token_hash,email,status,created_by,created_at,expires_at,used_at,application_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing", [role, hash, lower(r.Candidate_Email), text(r.Status) || "active", text(r.Created_By_Email || r.Created_By_Name), iso(r.Created_At), text(r.Expires_At) || null, text(r.Used_At) || null, app])); } }
async function backfillBulk() { if (!wanted.has("bulk_queue")) return; const source = await readTab("main", "Bulk_Resume_Queue"); const roles = await roleMap(); const apps = await existingMap("applications", "external_id", "id"); for (const r of source.rows) { tally("bulk_queue", "discovered"); const role = roles.get(text(r.roleId)) || (dryRoleExternalIds.has(text(r.roleId)) ? `dry:${text(r.roleId)}` : null); const sha = text(r.resumeSha256 || r.resume_sha256 || r.driveFileId || r.driveFileName); const app = apps.get(text(r.applicationId)) || plannedApplications.get(text(r.applicationId)) || null; if (!role || !sha) { tally("bulk_queue", "fkFailures"); tally("bulk_queue", "unmapped"); continue; } const [f] = String(role).startsWith("dry:") ? [] : await sql.query("select 1 from bulk_screening_queue_items where role_id=$1 and resume_sha256=$2", [role, sha]); await insertOrSkip("bulk_queue", !!f, () => sql.query("insert into bulk_screening_queue_items (batch_id,role_id,dedupe_key,resume_sha256,drive_file_id,filename,file_url,mime_type,status,application_id,candidate_name,candidate_email,preferred_mobile,applicant_country,error_message,attempt_count,source,environment,is_uat,job_id,discovered_at,processing_started_at,processed_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) on conflict do nothing", [text(r.batchId), role, `${text(r.roleId)}:${sha}`, sha, text(r.driveFileId), text(r.driveFileName), text(r.driveFileUrl), text(r.driveFileMimeType), text(r.status) || "queued", app, text(r.candidateName), lower(r.candidateEmail), text(r.preferredMobile), text(r.applicantCountry), text(r.errorMessage), Number(r.attemptCount) || 0, text(r.source) || "drive", text(r.environment), lower(r.is_uat) === "true", text(r.jobId), iso(r.discoveredAt), text(r.processingStartedAt) || null, text(r.processedAt) || null])); } }
async function backfillSlots() { if (!wanted.has("interview_slots")) return; const source = await readTab("main", "Interview_Slots"); const roles = await roleMap(); const apps = await existingMap("applications", "external_id", "id"); for (const r of source.rows) { tally("interview_slots", "discovered"); const slot = text(r.Slot_ID); if (!slot) { tally("interview_slots", "rejected"); continue; } const [f] = await sql.query("select 1 from interview_slots where slot_code=$1", [slot]); const role = roles.get(text(r.Role_ID)) || (dryRoleExternalIds.has(text(r.Role_ID)) ? `dry:${text(r.Role_ID)}` : null); const app = apps.get(text(r.Application_ID)) || plannedApplications.get(text(r.Application_ID)) || null; if (text(r.Role_ID) && !role) tally("interview_slots", "fkFailures"); await insertOrSkip("interview_slots", !!f, () => sql.query("insert into interview_slots (slot_code,interview_type,role_id,starts_at,ends_at,timezone,status,application_id,candidate_name,candidate_email,booked_at,interviewer_name,interviewer_email,hod_name,hod_email,calendar_event_id,calendar_event_link,calendar_event_status,calendar_event_error) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) on conflict do nothing", [slot, text(r.Interview_Type).toLowerCase().includes("final") ? "final" : "voice", role, iso(`${text(r.Date)} ${text(r.Start_Time)}`), iso(`${text(r.Date)} ${text(r.End_Time)}`), text(r.Timezone), text(r.Status).toLowerCase().replaceAll(" ", "_") || "available", app, text(r.Candidate_Name), lower(r.Candidate_Email), text(r.Booked_At) || null, text(r.Interviewer_Name), lower(r.Interviewer_Email), text(r.HOD_Name), lower(r.HOD_Email), text(r.Google_Calendar_Event_ID), text(r.Google_Calendar_Event_Link), text(r.Google_Calendar_Event_Status), text(r.Google_Calendar_Event_Error)])); } }
async function backfillVoice() { const roles = await roleMap(); const apps = await existingMap("applications", "external_id", "id"); if (wanted.has("voice_attempts")) { const source = await readTab("main", "Voice_Call_Queue"); for (const r of source.rows) { tally("voice_attempts", "discovered"); const app = apps.get(text(r.Application_ID) || text(r.application_id)) || plannedApplications.get(text(r.Application_ID) || text(r.application_id)); const key = text(r.Voice_Call_ID) || crypto.createHash("sha256").update(json(r)).digest("hex"); if (!app) { tally("voice_attempts", "fkFailures"); tally("voice_attempts", "unmapped"); continue; } const id = stableUuid(`attempt:${key}`); const [f] = await sql.query("select 1 from voice_call_attempts where id=$1", [id]); await insertOrSkip("voice_attempts", !!f, () => sql.query("insert into voice_call_attempts (id,application_id,role_id,attempt_number,max_attempts,scheduled_at,retry_after,status,preferred_mobile,contact_number,applicant_country,provider_call_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict do nothing", [id, app, roles.get(text(r.Role_ID)) || null, Number(r.Voice_Call_Attempts) || 1, Number(r.Voice_Call_Max_Attempts) || 3, text(r.Voice_Call_Scheduled_At) || null, text(r.Voice_Call_Next_Retry_At) || null, text(r.Voice_Call_Status) || "scheduled", text(r.Preferred_Mobile), text(r.Contact_Number || r["Contact Number"]), text(r.Applicant_Country), text(r.Voice_Call_ID)])); } } if (wanted.has("voice_results")) { const source = await readTab("main", "Voice_Interview_Results"); for (const r of source.rows) { tally("voice_results", "discovered"); const app = apps.get(text(r.Application_ID)) || plannedApplications.get(text(r.Application_ID)); const key = text(r.Provider_Event_ID) || text(r.Call_ID) || crypto.createHash("sha256").update(json(r)).digest("hex"); if (!app) { tally("voice_results", "fkFailures"); tally("voice_results", "unmapped"); continue; } const id = stableUuid(`result:${key}`); const [f] = await sql.query("select 1 from voice_interview_results where id=$1", [id]); await insertOrSkip("voice_results", !!f, () => sql.query("insert into voice_interview_results (id,application_id,score,recommendation,strengths,concerns,summary,transcript,call_status,call_final_status,provider_event_type,result_received_at,call_completed_at,raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict do nothing", [id, app, Number(r.Voice_Score) || null, text(r.Voice_Recommendation), text(r.Voice_Strengths), text(r.Voice_Concerns), text(r.AI_Voice_Summary), text(r.Transcript), text(r.Call_Status), text(r.Call_Final_Status), text(r.Provider_Event_Type), text(r.Result_Received_At), text(r.Call_Completed_At), json(r)])); } } }

function printSummary() { console.log("\n== summary =="); for (const [domain, c] of Object.entries(report)) console.log(`  ${domain.padEnd(22)} source ${c.discovered} valid ${c.valid} proposed ${c.proposed} skipped ${c.skipped} duplicates ${c.duplicates} rejected ${c.rejected} unmapped ${c.unmapped} fk-failures ${c.fkFailures} identity-collisions ${c.identityCollisions}`); if (errors.length) console.log(`\nBLOCKED source reads: ${errors.map((e) => `${e.workbook}/${e.tab}: ${e.message}`).join(" | ")}`); }

console.log(`recruitment backfill — ${commit ? "COMMIT (writing)" : "DRY RUN (no writes)"} — ${requested.join(",")}`);
try { await sql.query("select 1 from roles limit 1", []); } catch { console.error("BLOCKED — recruitment-core tables are not migrated."); process.exit(2); }
try {
  if (wanted.has("roles") || wanted.has("departments")) await backfillRoles();
  if (wanted.has("applicants") || wanted.has("applications")) await backfillApplicantsAndApplications();
  if (wanted.has("applicant_aliases") || wanted.has("resume_files") || wanted.has("screening_results") || wanted.has("booking_tokens") || wanted.has("application_history")) await backfillApplicationsSupport();
  await auditHistoricalPlaceholders(); await backfillUsers(); await backfillPortalSettings(); await backfillRoleHistory(); await backfillInvitations(); await backfillBulk(); await backfillSlots(); await backfillVoice(); await auditVoiceLogs(); await auditFinalInterview();
} catch (error) { console.error(`\nBLOCKED — ${error.message}`); printSummary(); process.exit(2); }
printSummary();
for (const [domain, c] of Object.entries(report)) console.log(`  ${domain} manual-review ${c.manualReview} destination-pending ${c.destinationPending}`);

function finalInterviewStatus(r, relatedHistory = []) { const direct = lower(r.Status || r.Final_Interview_Status); const history = relatedHistory.map((h) => lower(`${h.New_Status || ""} ${h.Action || ""}`)).join(" | "); const s = `${direct} ${history}`; if (s.includes("no show")) return "no_show"; if (s.includes("cancel")) return "cancelled"; if (s.includes("complete") || s.includes("pass")) return "completed"; if (s.includes("schedul") || s.includes("book")) return "scheduled"; const hasEvidence = [r.Interview_Date, r.Interview_Time, r.Booking_Link, r.Google_Calendar_Event_ID, r.Decision, r.Comments].some((v) => text(v)); return hasEvidence ? "scheduled" : "historical_unknown"; }
async function auditFinalInterview() {
  if (!wanted.has("final_interview")) return;
  if (commit) throw new Error("final_interview requires reviewed application/slot conflict handling; commit is disabled for this audit domain");
  const source = await readTab("main", "Final_Interview_Tracking"); const history = await readTab("main", "Candidate_Status_History"); const apps = await existingMap("applications", "external_id", "id"); const historyByApp = new Map(); for (const h of history.rows) { const key = text(h.Application_ID || h["Application ID"]); if (key) historyByApp.set(key, [...(historyByApp.get(key) || []), h]); }
  for (const r of source.rows) { tally("final_interview", "discovered"); const appKey = text(r.Application_ID || r["Application ID"]); const app = apps.get(appKey) || plannedApplications.get(appKey); if (!app) { tally("final_interview", "unmapped"); tally("final_interview", "fkFailures"); continue; } tally("final_interview", "valid"); tally("final_interview", "proposed"); if (finalInterviewStatus(r, historyByApp.get(appKey) || []) === "historical_unknown") tally("final_interview", "manualReview"); }
}
async function auditVoiceLogs() {
  if (!wanted.has("voice_logs")) return;
  if (commit) throw new Error("voice_logs requires 0004_voice_call_logs.sql to be applied before commit");
  const source = await readTab("main", "Voice_Call_Logs"); const apps = await existingMap("applications", "external_id", "id"); const seen = new Set();
  for (const r of source.rows) { tally("voice_logs", "discovered"); const appKey = text(r.Application_ID); const app = apps.get(appKey) || plannedApplications.get(appKey); const eventKey = text(r.Provider_Event_ID) || text(r.Call_ID) || crypto.createHash("sha256").update(json(r)).digest("hex"); if (!app || !eventKey) { tally("voice_logs", "unmapped"); tally("voice_logs", "fkFailures"); continue; } if (seen.has(eventKey)) { tally("voice_logs", "duplicates"); continue; } seen.add(eventKey); tally("voice_logs", "valid"); tally("voice_logs", "proposed"); tally("voice_logs", "destinationPending"); }
}
if (commit) { const runId = crypto.randomUUID(); await sql.query('create table if not exists "_backfill_journal" ("id" uuid primary key,"at" timestamptz not null default now(),"summary" jsonb not null)', []); await sql.query('insert into "_backfill_journal" ("id","summary") values ($1,$2)', [runId, json({ requested, report })]); console.log(`journal row _backfill_journal/${runId}`); }
console.log(`\n${Object.values(report).every((r) => r.fkFailures === 0 && r.identityCollisions === 0) ? "OK" : "WARN — review mapping/FK/identity results"}`);
