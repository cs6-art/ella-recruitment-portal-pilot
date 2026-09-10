// Read-only parity for recruitment entities. No writes, no reconciliation.
//
// This is a MIGRATION-ERA aid: it compares the legacy Google Sheets recruitment
// tabs against Postgres. Once the Pilot has cut over (`RECRUITMENT_BACKEND=postgres`),
// the portal no longer writes those Sheets — n8n and manual edits do — so a
// full Sheets<->Postgres row/field comparison is no longer a meaningful signal.
// Ongoing structural + referential integrity is enforced by
// `npm run db:check:recruitment:integrity`, which is the authoritative check.
//
// Default behaviour: the Pilot recruitment portal has moved to a Postgres
// authoritative store (see docs/N8N-SHEETS-TO-API-MIGRATION.md and the
// target-stack suite), so this check prints a SUPERSEDED notice and exits 0,
// pointing at db:check:recruitment:integrity.
//   * --legacy-parity forces the raw Sheets<->Postgres comparison to run
//     (for auditing a pre-cutover backfill).
//
// The legacy comparison resolves each Sheet tab to whichever configured
// workbook actually contains it (GOOGLE_SHEETS_SPREADSHEET_ID and
// GOOGLE_CANDIDATE_SPREADSHEET_ID), so it does not depend on a fixed tab->file
// map that silently breaks when a workbook is reorganised.

import crypto from "node:crypto";
import { google } from "googleapis";
import { neon } from "@neondatabase/serverless";

const forceLegacy = process.argv.includes("--legacy-parity");

if (!forceLegacy) {
  console.log("Recruitment parity check — SUPERSEDED");
  console.log("");
  console.log(`  RECRUITMENT_BACKEND=${process.env.RECRUITMENT_BACKEND ?? "(unset)"}`);
  console.log("  The Pilot recruitment portal is Postgres-authoritative. The legacy Google");
  console.log("  Sheets recruitment tabs are no longer written by the portal, so a full");
  console.log("  Sheets<->Postgres comparison is not a meaningful parity signal.");
  console.log("");
  console.log("  Ongoing integrity is enforced by:");
  console.log("    npm run db:check:recruitment:integrity   (tables, FKs, constraints, orphans)");
  console.log("");
  console.log("  To run the legacy comparison anyway (e.g. auditing a pre-cutover backfill):");
  console.log("    node src/db/check-recruitment-parity.mjs --legacy-parity");
  console.log("");
  console.log("OVERALL: SUPERSEDED — not a blocker. Use db:check:recruitment:integrity.");
  process.exit(0);
}

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const requested = onlyArg ? onlyArg.slice(7).split(",").map((s) => s.trim()).filter(Boolean) : ["roles", "applicants", "applications"];
const domains = requested.includes("all") ? ["users", "roles", "role_history", "applicants", "applicant_aliases", "resume_files", "applications", "application_history", "screening_results", "screening_invitations", "bulk_queue", "interview_slots", "voice_attempts", "voice_results", "booking_tokens", "portal_settings"] : requested;
const dbUrl = process.env.DATABASE_URL?.trim();
const mainId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
const rolesId = process.env.GOOGLE_CANDIDATE_SPREADSHEET_ID?.trim();
const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
const key = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/^"(.*)"$/s, "$1").replace(/\\n/g, "\n").trim();
for (const [name, value] of Object.entries({ DATABASE_URL: dbUrl, GOOGLE_SHEETS_SPREADSHEET_ID: mainId, GOOGLE_CANDIDATE_SPREADSHEET_ID: rolesId, GOOGLE_SERVICE_ACCOUNT_EMAIL: email, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: key })) if (!value) { console.error(`BLOCKED — missing ${name}`); process.exit(2); }
const sql = neon(dbUrl);
const auth = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
const sheets = google.sheets({ version: "v4", auth });
const text = (v) => (v === undefined || v === null ? "" : String(v).trim());
const numberOrNull = (v) => { const n = Number(text(v)); return Number.isFinite(n) && text(v) !== "" ? n : null; };
const roleStatus = (raw) => { const s = text(raw).toLowerCase(); if (s.includes("approv")) return "approved"; if (s.includes("posted")) return "job_posted"; if (s.includes("setup")) return "recruitment_setup"; if (s.includes("reject")) return "rejected"; if (s.includes("hold")) return "on_hold"; if (s.includes("return")) return "returned_for_revision"; if (s.includes("hr")) return "pending_hr_discussion"; return "draft"; };
const applicationStage = (r) => { const final = text(r.Final_Status || r["Status 3 (Final Interview)"]).toLowerCase(); if (final.includes("reject")) return "rejected"; if (final.includes("pass")) return "passed_final"; if (final.includes("final")) return "approved_for_final"; if (text(r["Status 2 (Voice Interview)"]).toLowerCase().includes("voice")) return "voice_review_pending"; if (text(r.Voice_Interview_Booking_Status).toLowerCase().includes("booked")) return "voice_scheduled"; if (text(r.Resume_HR_Decision).toLowerCase() === "approve") return "resume_approved"; return "resume_review"; };
const slotStatus = (raw) => text(raw).toLowerCase().replaceAll(" ", "_") || "available";
const dbSettingKeys = new Set(["Booking_Default_Timezone", "Final_Interview_Calendar_Email", "Final_Interview_Calendar_ID", "Voice_Interview_Duration_Minutes", "Final_Interview_Duration_Minutes", "Booking_Link_Expiry_Days", "Require_Resume_HR_Approval", "Require_Voice_HR_Approval", "Booking_Invitation_Auto_Send", "Voice_Call_Max_Attempts", "Voice_Call_Retry_Gap_Hours", "Ella_Credit_Cost_CV_Analysis", "Ella_Credit_Cost_Phone_Interview", "Ella_Credit_Discount_Threshold", "Ella_Credit_Discount_Percent"]);
const stableUuid = (value) => { const h = crypto.createHash("sha256").update(String(value)).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")}${h.slice(18, 20)}-${h.slice(20, 32)}`; };
const sourceMap = {
  users: ["roles", "User_Directory", "email", (r) => [text(r.Email).toLowerCase()]],
  roles: ["roles", "Role_Requests", "external_id", (r) => [text(r.Role_ID || r.Submission_ID)]],
  role_history: ["roles", "Role_Status_History", "action_request_id", (r) => [text(r.Action_Request_ID) || text(r.History_ID)]],
  applicants: ["main", "High_Match_Profile", "primary_email", (r) => [text(r.Email).toLowerCase()]],
  applicant_aliases: ["main", "High_Match_Profile", "kind:value", (r) => [["email", text(r.Email).toLowerCase()], ["name", text(r["Candidate Name"]).toLowerCase()], ["phone", text(r.Preferred_Mobile || r["Contact Number"])].filter(([, v]) => v).map(([k, v]) => `${k}:${v}`)].flat()],
  resume_files: ["main", "High_Match_Profile", "storage_ref", (r) => [text(r.Resume_File_Id)]],
  applications: ["main", "High_Match_Profile", "external_id", (r) => [text(r["Application ID"] || r.Application_ID)]],
  application_history: ["main", "Candidate_Status_History", "action_request_id", (r) => [text(r.Action_Request_ID) || text(r.History_ID)]],
  screening_results: ["main", "High_Match_Profile", "application_id", (r) => [text(r["Application ID"] || r.Application_ID)]],
  screening_invitations: ["main", "Resume_Screening_Invitations", "token_hash", (r) => [text(r.Token_Hash)]],
  bulk_queue: ["main", "Bulk_Resume_Queue", "dedupe_key", (r) => { const role = text(r.roleId); const sha = text(r.resumeSha256 || r.resume_sha256 || r.driveFileId || r.driveFileName); return role && sha ? [`${role}:${sha}`] : []; }],
  interview_slots: ["main", "Interview_Slots", "slot_code", (r) => [text(r.Slot_ID)]],
  voice_attempts: ["main", "Voice_Call_Queue", "id", (r) => { const k = text(r.Voice_Call_ID); return k ? [stableUuid(`attempt:${k}`)] : []; }],
  voice_results: ["main", "Voice_Interview_Results", "id", (r) => { const k = text(r.Provider_Event_ID) || text(r.Call_ID); return k ? [stableUuid(`result:${k}`)] : []; }],
  booking_tokens: ["main", "High_Match_Profile", "token_hash", (r) => [text(r.Booking_Token_Hash), text(r.Final_Interview_Booking_Token_Hash)].filter(Boolean)],
  portal_settings: ["main", "Settings", "key", (r) => dbSettingKeys.has(text(r.Setting_Key)) ? [text(r.Setting_Key)] : []],
};
const dbColumns = { users: "email", roles: "external_id", role_history: "action_request_id", applicants: "primary_email", applicant_aliases: "kind || ':' || value", resume_files: "storage_ref", applications: "external_id", application_history: "action_request_id", screening_results: "application_id", screening_invitations: "token_hash", bulk_queue: "dedupe_key", interview_slots: "slot_code", voice_attempts: "id", voice_results: "id", booking_tokens: "token_hash", portal_settings: "key" };
const tableNames = { role_history: '"role_status_history"', application_history: '"application_status_history"', bulk_queue: '"bulk_screening_queue_items"', voice_attempts: '"voice_call_attempts"', voice_results: '"voice_interview_results"' };

// Resolve each Sheet tab to whichever configured workbook actually contains it.
// The two workbooks (GOOGLE_SHEETS_SPREADSHEET_ID and GOOGLE_CANDIDATE_SPREADSHEET_ID)
// have been reorganised over the project's life; a fixed tab->file map goes stale
// silently and produces "Unable to parse range" errors. Probing is resilient.
const workbookCandidates = [...new Set([mainId, rolesId].filter(Boolean))];
let tabIndexPromise = null;
async function tabIndex() {
  if (!tabIndexPromise) {
    tabIndexPromise = (async () => {
      const index = new Map();
      for (const spreadsheetId of workbookCandidates) {
        const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
        for (const s of meta.data.sheets ?? []) {
          const title = s.properties?.title;
          if (title && !index.has(title)) index.set(title, spreadsheetId);
        }
      }
      return index;
    })();
  }
  return tabIndexPromise;
}

async function readTab(workbook, tab) {
  const index = await tabIndex();
  const id = index.get(tab);
  if (!id) {
    throw new Error(
      `tab '${tab}' was not found in any configured workbook (${workbookCandidates.join(", ") || "none"}). ` +
        `It may have been renamed or removed by the Sheets->Postgres migration; ` +
        `run 'npm run db:check:recruitment:integrity' for the authoritative check.`,
    );
  }
  const range = `'${tab.replaceAll("'", "''")}'!A:ZZ`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: id, range });
  const values = res.data.values || []; const headers = values[0] || [];
  return values.slice(1).filter((r) => r.some((c) => text(c))).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}
function diff(domain, sourceIds, dbIds) { const missing = [...sourceIds].filter((id) => !dbIds.has(id)); const extra = [...dbIds].filter((id) => !sourceIds.has(id)); const ok = missing.length === 0 && extra.length === 0; console.log(`${domain}: source ${sourceIds.size} / db ${dbIds.size} missing ${missing.length} extra ${extra.length} duplicates ${sourceIds.size < sourceIds.raw ? sourceIds.raw - sourceIds.size : 0} ${ok ? "PASS" : "FAIL"}`); return ok; }

const fieldSpecs = {
  roles: { table: '"roles"', source: (r) => [text(r.Role_ID || r.Submission_ID), { status: roleStatus(r.Status) }], db: "external_id, status" },
  applications: { table: '"applications"', source: (r) => [text(r["Application ID"] || r.Application_ID), { current_stage: applicationStage(r) }], db: "external_id, current_stage" },
  screening_results: { source: (r) => [text(r["Application ID"] || r.Application_ID), { match_score: numberOrNull(r["Match Score"]), recommendation: text(r.Recommendation) }], query: 'select a.external_id, s.match_score, s.recommendation from "screening_results" s join "applications" a on a.id = s.application_id' },
  voice_results: { table: '"voice_interview_results"', source: (r) => { const k = text(r.Provider_Event_ID) || text(r.Call_ID); return [k ? stableUuid(`result:${k}`) : "", { call_status: text(r.Call_Status), call_final_status: text(r.Call_Final_Status), provider_event_type: text(r.Provider_Event_Type) }]; }, db: "id, call_status, call_final_status, provider_event_type" },
  interview_slots: { table: '"interview_slots"', source: (r) => [text(r.Slot_ID), { status: slotStatus(r.Status) }], db: "slot_code, status" },
  bulk_queue: { table: '"bulk_screening_queue_items"', source: (r) => { const role = text(r.roleId); const sha = text(r.resumeSha256 || r.resume_sha256 || r.driveFileId || r.driveFileName); return [role && sha ? `${role}:${sha}` : "", { status: text(r.status) || "queued" }]; }, db: "dedupe_key, status" },
};

async function fieldParity(domain, rows) {
  const spec = fieldSpecs[domain];
  if (!spec) return true;
  const source = new Map();
  for (const row of rows) { const [id, values] = spec.source(row); if (id) source.set(id, values); }
  const dbRows = await sql.query(spec.query || `select ${spec.db} from ${spec.table}`, []);
  const db = new Map(dbRows.map((row) => [text(row[Object.keys(row)[0]]), row]));
  const mismatches = [];
  for (const [id, expected] of source) {
    const actual = db.get(id);
    if (!actual) continue;
    for (const [field, value] of Object.entries(expected)) {
      const got = field === "match_score" ? (actual[field] == null ? null : Number(actual[field])) : text(actual[field]);
      if (got !== value) mismatches.push(`${id}:${field}`);
    }
  }
  console.log(`${domain} field parity: mismatches ${mismatches.length}${mismatches.length ? ` (${mismatches.slice(0, 5).join(", ")})` : " PASS"}`);
  return mismatches.length === 0;
}

const checks = [];
for (const domain of domains) {
  const spec = sourceMap[domain];
  if (!spec) { console.error(`${domain}: UNSUPPORTED`); checks.push(false); continue; }
  try {
    const rows = await readTab(spec[0], spec[1]); const rawIds = rows.flatMap(spec[3]).filter(Boolean); const sourceIds = new Set(rawIds); sourceIds.raw = rawIds.length;
    const dbRows = await sql.query(`select ${dbColumns[domain]} as value from ${tableNames[domain] || `"${domain}"`} where ${dbColumns[domain]} is not null`, []);
    const dbIds = new Set(dbRows.map((r) => text(r.value)).filter(Boolean)); checks.push(diff(domain, sourceIds, dbIds)); checks.push(await fieldParity(domain, rows));
  } catch (error) { console.error(`${domain}: BLOCKED — ${error.message}`); checks.push(false); }
}
const ok = checks.every(Boolean); console.log(`\nOVERALL: ${ok ? "PASS" : "FAIL"}`); process.exit(ok ? 0 : 1);
