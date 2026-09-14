// Provision a client organization and its own physical recruitment database.
// The control-plane DATABASE_URL stores organizations, memberships, and
// credits. --database-url is the fresh client Postgres database URL; it is
// never written to the database or printed by this script.
//
// Usage:
//   npm run db:provision:organization -- --name "Acme Recruiting" --slug acme --admin-email hr@acme.com --admin-name "Jane HR" --database-url "postgresql://..." [--starter-credits 50]

import crypto from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { neon } from "@neondatabase/serverless";

function arg(name) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) return "";
  return process.argv[index + 1];
}

const name = arg("name").trim();
const slug = arg("slug").trim().toLowerCase();
const adminEmail = arg("admin-email").trim().toLowerCase();
const adminName = arg("admin-name").trim();
const tenantDatabaseUrl = arg("database-url").trim();
const starterCredits = Number.parseInt(arg("starter-credits") || "0", 10) || 0;
const controlDatabaseUrl = process.env.DATABASE_URL?.trim() || "";

if (!name || !slug || !adminEmail || !adminName || !tenantDatabaseUrl) {
  console.error("Usage: --name <org name> --slug <url-safe slug> --admin-email <email> --admin-name <full name> --database-url <fresh Postgres URL> [--starter-credits <n>]");
  process.exit(2);
}
if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
  console.error(`BLOCKED — --slug "${slug}" must be lowercase letters/digits/hyphens.`);
  process.exit(2);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
  console.error(`BLOCKED — --admin-email "${adminEmail}" does not look like an email address.`);
  process.exit(2);
}
if (!Number.isFinite(starterCredits) || starterCredits < 0) {
  console.error("BLOCKED — --starter-credits must be a whole number >= 0.");
  process.exit(2);
}
if (!controlDatabaseUrl) {
  console.error("BLOCKED — DATABASE_URL is not configured for the control plane.");
  process.exit(2);
}
if (tenantDatabaseUrl === controlDatabaseUrl) {
  console.error("BLOCKED — --database-url must be a different physical database from DATABASE_URL.");
  process.exit(2);
}

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");
const migrateScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrate.mjs");

async function migrateTenantDatabase() {
  const migrationFiles = (await readdir(migrationsDir)).filter((file) => /^\d{4}_[a-z0-9_-]+\.sql$/.test(file)).sort();
  for (const migration of migrationFiles) {
    const result = spawnSync(process.execPath, [migrateScript, `--target=${migration}`], {
      env: { ...process.env, DATABASE_URL: tenantDatabaseUrl },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      console.error(`BLOCKED — tenant database migration failed at ${migration}. Check the tenant database and retry.`);
      process.exit(1);
    }
  }
}

await migrateTenantDatabase();

const controlSql = neon(controlDatabaseUrl);
const tenantSql = neon(tenantDatabaseUrl);
const organizationId = crypto.randomUUID();
const userId = crypto.randomUUID();

const existingOrg = await controlSql`select id, name, database_key, database_status from organizations where slug = ${slug}`;
const resolvedOrgId = existingOrg[0]?.id || organizationId;
if (existingOrg[0]) {
  if (existingOrg[0].database_key !== slug) {
    console.error("BLOCKED — this organization already uses a different database key; migrate it explicitly before retrying.");
    process.exit(1);
  }
  console.log(`Organization "${slug}" already exists (${existingOrg[0].id}, "${existingOrg[0].name}") — reusing it.`);
} else {
  await controlSql`insert into organizations (id, slug, name, database_key, database_status, active) values (${organizationId}, ${slug}, ${name}, ${slug}, 'ready', true)`;
  console.log(`Created organization "${name}" (${organizationId}, slug "${slug}").`);
}

await controlSql`update organizations set database_status = 'ready', updated_at = now() where id = ${resolvedOrgId}`;

// Create the local organization row required by tenant-owned foreign keys.
const tenantOrganizations = await tenantSql`select id from organizations where id <> '00000000-0000-4000-8000-000000000001'`;
if (tenantOrganizations.some((row) => row.id !== resolvedOrgId)) {
  console.error("BLOCKED — --database-url is not a fresh database or the existing client database belongs to another organization.");
  process.exit(1);
}
await tenantSql`delete from organization_memberships where organization_id = '00000000-0000-4000-8000-000000000001'`;
await tenantSql`delete from credit_accounts where organization_id = '00000000-0000-4000-8000-000000000001'`;
await tenantSql`delete from organizations where id = '00000000-0000-4000-8000-000000000001'`;
await tenantSql`
  insert into organizations (id, slug, name, database_key, database_status, active)
  values (${resolvedOrgId}, ${slug}, ${name}, ${slug}, 'ready', true)
  on conflict (id) do update set name = excluded.name, slug = excluded.slug, database_key = excluded.database_key, database_status = 'ready', active = true
`;

await tenantSql`
  insert into users (id, organization_id, email, full_name, access_role, can_create_role, can_review_role, can_approve_role, can_edit_settings, can_manage_users, can_review_department_role, active)
  values (${userId}, ${resolvedOrgId}, ${adminEmail}, ${adminName}, 'Admin', true, true, true, true, true, true, true)
  on conflict (email) do update set organization_id = excluded.organization_id, full_name = excluded.full_name, access_role = excluded.access_role, can_create_role = true, can_review_role = true, can_approve_role = true, can_edit_settings = true, can_manage_users = true, can_review_department_role = true, active = true
`;

await controlSql`
  insert into organization_memberships (organization_id, email, active)
  values (${resolvedOrgId}, ${adminEmail}, true)
  on conflict (organization_id, email) do update set active = true, updated_at = now()
`;
await controlSql`
  insert into credit_accounts (organization_id, owner_email, balance)
  values (${resolvedOrgId}, ${adminEmail}, ${starterCredits})
  on conflict (organization_id, owner_email) do nothing
`;
await tenantSql`
  insert into credit_accounts (organization_id, owner_email, balance)
  values (${resolvedOrgId}, ${adminEmail}, ${starterCredits})
  on conflict (organization_id, owner_email) do nothing
`;

const summary = await controlSql`
  select o.id as organization_id, o.slug, o.name, o.database_key, o.database_status,
         m.active as membership_active, ca.balance as credit_balance
  from organizations o
  left join organization_memberships m on m.organization_id = o.id and m.email = ${adminEmail}
  left join credit_accounts ca on ca.organization_id = o.id and ca.owner_email = ${adminEmail}
  where o.id = ${resolvedOrgId}
`;

console.log(JSON.stringify(summary[0], null, 2));
console.log(`Done. ${adminName} <${adminEmail}> can log in after TENANT_DATABASE_URLS includes ${resolvedOrgId}: <tenant database URL>.`);
