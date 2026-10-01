import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const script = readFileSync("src/db/check-system-health.mjs", "utf8");
const migrations = readdirSync("drizzle")
  .filter((name) => name.endsWith(".sql"))
  .map((name) => readFileSync(`drizzle/${name}`, "utf8"))
  .join("\n")
  .replace(/\r\n/g, "\n");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const createTableBody = (table) => migrations.match(new RegExp(`create table (?:if not exists )?"?${escapeRegex(table)}"?\\s*\\(([\\s\\S]*?)\\n\\)`, "i"))?.[1];
const alterations = (table) => [...migrations.matchAll(new RegExp(`alter table "?${escapeRegex(table)}"?[^;]*`, "gi"))].map((m) => m[0]).join("\n");

test("npm run check:health is registered and loads .env.local", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts["check:health"], "node --env-file-if-exists=.env.local src/db/check-system-health.mjs");
});

test("the health check is strictly read-only", () => {
  const sqlText = [...script.matchAll(/sql`([\s\S]*?)`/g)].map((match) => match[1]).join("\n");
  assert.ok(sqlText.length > 0);
  assert.doesNotMatch(sqlText, /\b(insert|update|delete|alter|drop|truncate|create)\b/i);
});

test("without DATABASE_URL it fails fast with exit code 2 and a clear message", () => {
  const env = { ...process.env, DATABASE_URL: "" };
  const result = spawnSync(process.execPath, ["src/db/check-system-health.mjs"], { env, encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /FAIL\s+DATABASE_URL is not configured/);
});

test("exit codes map 0 = clear, 1 = warnings, 2 = failures", () => {
  assert.match(script, /results\.some\(\(r\) => r\.level === "FAIL"\) \? 2 : results\.some\(\(r\) => r\.level === "WARN"\) \? 1 : 0/);
});

test("every table the health check queries exists in a migration", () => {
  const tables = new Set([...script.matchAll(/\b(?:from|join)\s+([a-z_]+)\b/g)].map((match) => match[1]));
  // _migrations is created by the migration runner itself; the others are prose/subquery aliases.
  for (const ignore of ["pg_database_size", "duplicates", "_migrations", "the"]) tables.delete(ignore);
  assert.ok(tables.size >= 8, `expected to find the queried tables, got ${[...tables]}`);
  for (const table of tables) assert.ok(createTableBody(table), `table ${table} is not created by any migration`);
});

test("the status columns it filters on exist in the schema", () => {
  const expected = {
    bulk_screening_queue_items: ["status", "processing_started_at", "discovered_at", "updated_at"],
    voice_call_attempts: ["status", "updated_at"],
    live_interview_sessions: ["status", "recording_status", "updated_at"],
    interview_slots: ["calendar_event_status", "updated_at"],
    application_status_history: ["notification_status", "changed_at"],
    role_status_history: ["notification_status", "changed_at"],
    credit_accounts: ["organization_id", "balance"],
    organization_recording_drive: ["organization_id", "folder_id"],
  };
  for (const [table, columns] of Object.entries(expected)) {
    const definition = `${createTableBody(table) || ""}\n${alterations(table)}`;
    for (const column of columns) {
      assert.match(definition, new RegExp(`"?${column}"?\\s`, "i"), `${table}.${column} not found in migrations`);
    }
  }
});

test("Neon usage warning triggers at 80% of a configured limit", () => {
  assert.match(script, /limit > 0 && used >= limit \* 0\.8/);
  // Unset limits are NaN, which must never produce a warning.
  assert.equal(Number(undefined) > 0, false);
});
