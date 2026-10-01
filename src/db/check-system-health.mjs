// Read-only system health check: `npm run check:health`.
// Answers "is anything in error or stuck right now?" across the database,
// migrations, background work, email, interviews, and each organization.
// It never writes. Exit code: 0 = all clear, 1 = warnings, 2 = failures.
//
// Optional: set NEON_API_KEY and NEON_PROJECT_ID to also report this billing
// period's Neon usage (the quota that blocked the database on 2026-09-24).
// NEON_TRANSFER_LIMIT_GB / NEON_COMPUTE_LIMIT_HOURS turn that into a warning
// at 80% of your plan's allowance.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("FAIL  DATABASE_URL is not configured");
  process.exit(2);
}
const sql = neon(databaseUrl);
const results = [];
const record = (level, label, detail = "", hint = "") => results.push({ level, label, detail, hint });
const count = async (query) => (await query)[0]?.n ?? 0;

async function check(label, run) {
  try {
    await run();
  } catch (error) {
    record("FAIL", label, error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
}

// Counts that should be zero. warnAt/failAt are thresholds on the count.
async function expectZero(label, query, hint, { failAt = Infinity } = {}) {
  await check(label, async () => {
    const n = await count(query);
    record(n === 0 ? "PASS" : n >= failAt ? "FAIL" : "WARN", label, n === 0 ? "" : `${n}`, n === 0 ? "" : hint);
  });
}

// 1. Database reachable (a quota block shows up here as an HTTP 402 error).
let reachable = false;
await check("Database reachable", async () => {
  const started = Date.now();
  await sql`select 1`;
  const ms = Date.now() - started;
  reachable = true;
  record(ms > 3000 ? "WARN" : "PASS", "Database reachable", `${ms} ms`, ms > 3000 ? "Slow response: the database may be waking up or overloaded." : "");
});
if (!reachable) {
  results[0].hint = "If the error mentions 402 or quota, the Neon plan allowance is used up. Upgrade the plan in Vercel > Storage > Neon.";
  print();
  process.exit(2);
}

await check("Database size", async () => {
  const [{ bytes }] = await sql`select pg_database_size(current_database())::bigint as bytes`;
  record("INFO", "Database size", `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`);
});

// 2. Neon plan usage (optional).
const neonKey = process.env.NEON_API_KEY?.trim();
const neonProject = process.env.NEON_PROJECT_ID?.trim();
if (neonKey && neonProject) {
  await check("Neon plan usage", async () => {
    const response = await fetch(`https://console.neon.tech/api/v2/projects/${neonProject}`, { headers: { Authorization: `Bearer ${neonKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Neon API returned ${response.status}`);
    const { project } = await response.json();
    const transferGb = Number(project.data_transfer_bytes || 0) / 1e9;
    const computeHours = Number(project.compute_time_seconds || 0) / 3600;
    const limits = [[transferGb, Number(process.env.NEON_TRANSFER_LIMIT_GB)], [computeHours, Number(process.env.NEON_COMPUTE_LIMIT_HOURS)]];
    const nearLimit = limits.some(([used, limit]) => limit > 0 && used >= limit * 0.8);
    record(nearLimit ? "WARN" : "INFO", "Neon usage this period", `data transfer ${transferGb.toFixed(2)} GB, compute ${computeHours.toFixed(1)} h (since ${String(project.consumption_period_start || "").slice(0, 10)})`, nearLimit ? "Over 80% of the plan allowance: upgrade before the database is blocked." : "");
  });
} else {
  record("INFO", "Neon plan usage", "not checked", "Set NEON_API_KEY and NEON_PROJECT_ID to include it.");
}

// 3. Every migration file has been applied.
await check("Migrations applied", async () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");
  const files = (await readdir(dir)).filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/.test(name));
  const applied = new Set((await sql`select name from _migrations`).map((row) => row.name));
  const missing = files.filter((name) => !applied.has(name));
  record(missing.length ? "FAIL" : "PASS", "Migrations applied", missing.length ? missing.join(", ") : `${files.length} of ${files.length}`, missing.length ? "Apply them before deploying code that depends on them." : "");
});

// 4. Background work that has failed or stalled.
await expectZero("Resume screenings failed (7 days)", sql`select count(*)::int as n from bulk_screening_queue_items where status = 'failed' and updated_at > now() - interval '7 days'`, "Check the resume screening worker in n8n and the AI provider quota.");
await expectZero("Resume screenings stuck processing over 30 min", sql`select count(*)::int as n from bulk_screening_queue_items where status = 'processing' and coalesce(processing_started_at, updated_at) < now() - interval '30 minutes'`, "The screening worker may be stopped. Check '[TARGET-PG][PILOT] Bulk Resume Upload Intake' in n8n.");
await expectZero("Resumes waiting in queue over 1 hour", sql`select count(*)::int as n from bulk_screening_queue_items where status = 'queued' and discovered_at < now() - interval '1 hour'`, "The screening worker is not picking up work.");
await expectZero("Voice calls failed (7 days)", sql`select count(*)::int as n from voice_call_attempts where status = 'failed' and updated_at > now() - interval '7 days'`, "Check the voice calling workflow and Vapi status.");
await expectZero("Voice calls stuck in progress over 2 hours", sql`select count(*)::int as n from voice_call_attempts where status in ('calling','initiated','in_progress') and updated_at < now() - interval '2 hours'`, "Check the Vapi Call Result Reconciler workflow in n8n.");
await expectZero("Live interviews stuck processing over 2 hours", sql`select count(*)::int as n from live_interview_sessions where status in ('INTERVIEW_COMPLETED','TRANSCRIPTION_PROCESSING','ANALYSIS_PROCESSING') and updated_at < now() - interval '2 hours'`, "Open the applicant and retry the review, or wait for the daily recovery job.");
await expectZero("Live interview analysis failed (7 days)", sql`select count(*)::int as n from live_interview_sessions where status = 'FAILED' and updated_at > now() - interval '7 days'`, "Check the AI provider quota, then retry from the applicant page.");
await expectZero("Live interview recordings failed (7 days)", sql`select count(*)::int as n from live_interview_sessions where recording_status = 'failed' and updated_at > now() - interval '7 days'`, "Check the organization's recording Drive folder in Settings.");
await expectZero("Calendar events failed (7 days)", sql`select count(*)::int as n from interview_slots where calendar_event_status = 'failed' and updated_at > now() - interval '7 days'`, "The interviewer's or the shared HR calendar may need reconnecting.");

// 5. Email.
await expectZero("Emails failed to send (7 days)", sql`select count(*)::int as n from application_status_history where notification_status = 'failed' and changed_at > now() - interval '7 days'`, "Check the email workflows and their Gmail connection in n8n.");
await expectZero("Candidate emails unsent after 24 hours", sql`select count(*)::int as n from application_status_history where notification_status = 'pending' and changed_at < now() - interval '24 hours'`, "No sender is picking these up. Clear them or switch the right sender on.");
await expectZero("Role emails unsent after 24 hours", sql`select count(*)::int as n from role_status_history where notification_status = 'pending' and changed_at < now() - interval '24 hours'`, "No sender is picking these up. Clear them or switch the right sender on.");

// 6. Data safety.
await expectZero("Applications linked to another organization's role or applicant", sql`select count(*)::int as n from applications a join roles r on r.id = a.role_id join applicants p on p.id = a.applicant_id where a.organization_id <> r.organization_id or a.organization_id <> p.organization_id`, "Cross-organization data: investigate immediately and run npm run db:check:recruitment:integrity.", { failAt: 1 });
await expectZero("Organizations with more than one credit account", sql`select count(*)::int as n from (select organization_id from credit_accounts group by organization_id having count(*) > 1) duplicates`, "Credits must be one shared balance per organization.", { failAt: 1 });

// 7. Per-organization setup (information for onboarding, not errors).
await check("Organization setup", async () => {
  const rows = await sql`
    select o.name,
      coalesce(c.balance, 0)::int as credits,
      (d.folder_id is not null and d.folder_id <> '') as recording_folder
    from organizations o
    left join credit_accounts c on c.organization_id = o.id
    left join organization_recording_drive d on d.organization_id = o.id
    order by o.name`;
  for (const row of rows) {
    const gaps = [row.credits <= 0 && "no credits", row.credits > 0 && row.credits < 10 && `low credits (${row.credits})`, !row.recording_folder && "no Live Avatar recording folder"].filter(Boolean);
    record(gaps.length ? "WARN" : "PASS", `Organization: ${row.name}`, gaps.length ? gaps.join(", ") : `${row.credits} credits, recording folder set`, gaps.length ? "Live Avatar interviews and screening need both." : "");
  }
});

function print() {
  const width = Math.max(...results.map((r) => r.label.length));
  for (const r of results) {
    console.log(`${r.level.padEnd(5)} ${r.label.padEnd(width)}  ${r.detail}`);
    if (r.hint) console.log(`${" ".repeat(width + 8)}→ ${r.hint}`);
  }
  const fails = results.filter((r) => r.level === "FAIL").length;
  const warns = results.filter((r) => r.level === "WARN").length;
  console.log(`\nOVERALL: ${fails ? "FAIL" : warns ? "NEEDS ATTENTION" : "ALL CLEAR"} (${fails} failures, ${warns} warnings)`);
}

print();
process.exit(results.some((r) => r.level === "FAIL") ? 2 : results.some((r) => r.level === "WARN") ? 1 : 0);
