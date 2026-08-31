// Minimal forward-only migration runner. Applies every drizzle/*.sql file that
// has not been recorded in the _migrations table yet, in filename order, each
// inside its own transaction. Run manually: `npm run db:migrate`.
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

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }
    const statements = splitStatements(await readFile(path.join(migrationsDir, file), "utf8"));
    console.log(`apply ${file} (${statements.length} statements)`);
    await sql.transaction([
      ...statements.map((statement) => sql.query(statement)),
      sql`INSERT INTO "_migrations" ("name") VALUES (${file})`,
    ]);
    ran += 1;
  }

  console.log(ran === 0 ? "Nothing to apply — database is up to date." : `Applied ${ran} migration(s).`);
}

main().catch((error) => {
  console.error("Migration failed:", error.message || error);
  process.exitCode = 1;
});
