// Minimal forward-only migration runner. A target is mandatory whenever there
// are pending files, so a later migration cannot be applied accidentally.
// Example: `npm run db:migrate -- --target=0002_payments.sql`.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set. Put it in .env.local or export it before running db:migrate.");
  process.exit(1);
}

const sql = neon(url);

function targetFromArgs() {
  const targetArg = process.argv.slice(2).find((arg) => arg.startsWith("--target="));
  if (!targetArg) return "";
  const target = targetArg.slice("--target=".length).trim();
  return target.endsWith(".sql") ? target : `${target}.sql`;
}

function validMigrationName(name) {
  return /^\d{4}_[a-z0-9_-]+\.sql$/.test(name);
}

/** Split a .sql file into individual statements: strip `-- line comments`, then split on `;`. */
function splitStatements(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function main() {
  await sql`CREATE TABLE IF NOT EXISTS "_migrations" (
    "name" text PRIMARY KEY,
    "applied_at" timestamptz NOT NULL DEFAULT now()
  )`;

  const applied = new Set((await sql`SELECT "name" FROM "_migrations"`).map((row) => row.name));

  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  const target = targetFromArgs();
  const pending = files.filter((file) => !applied.has(file));

  if (!target) {
    if (pending.length === 0) {
      console.log("Nothing to apply — database is up to date.");
      return;
    }
    console.error(`Refusing to apply ${pending.length} pending migration(s) without an explicit target.`);
    console.error(`Choose exactly one: ${pending.map((file) => `--target=${file}`).join(" or ")}`);
    process.exitCode = 2;
    return;
  }

  if (!validMigrationName(target) || !files.includes(target)) {
    console.error(`Unknown migration target: ${target}`);
    process.exitCode = 2;
    return;
  }

  const targetIndex = files.indexOf(target);
  const missingPrerequisites = files.slice(0, targetIndex).filter((file) => !applied.has(file));
  if (missingPrerequisites.length > 0) {
    console.error(`Refusing ${target}: prerequisite migration(s) are not recorded: ${missingPrerequisites.join(", ")}`);
    process.exitCode = 2;
    return;
  }

  if (applied.has(target)) {
    console.log(`skip  ${target} (already applied)`);
    return;
  }

  const statements = splitStatements(await readFile(path.join(migrationsDir, target), "utf8"));
  console.log(`apply ${target} (${statements.length} statements)`);
  await sql.transaction([
    ...statements.map((statement) => sql.query(statement)),
    sql`INSERT INTO "_migrations" ("name") VALUES (${target})`,
  ]);

  console.log(`Applied ${target}.`);
}

main().catch((error) => {
  console.error("Migration failed:", error.message || error);
  process.exitCode = 1;
});
