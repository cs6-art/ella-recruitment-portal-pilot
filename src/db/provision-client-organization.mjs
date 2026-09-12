// Provision a brand-new client organization: the organization row, its first
// HR admin user (Postgres-backed login — see src/lib/postgres-directory.ts),
// an active membership, and a zero-balance credit account.
//
// Usage:
//   node --env-file-if-exists=.env.local src/db/provision-client-organization.mjs \
//     --name "Acme Recruiting" --slug acme --admin-email hr@acme.com --admin-name "Jane HR" \
//     [--starter-credits 50]
//
// Idempotent: re-running with the same --slug/--admin-email updates nothing
// destructively (ON CONFLICT DO NOTHING on every insert); it just reports what
// already existed.

import crypto from "node:crypto";
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
const starterCredits = Number.parseInt(arg("starter-credits") || "0", 10) || 0;

if (!name || !slug || !adminEmail || !adminName) {
  console.error("Usage: --name <org name> --slug <url-safe slug> --admin-email <email> --admin-name <full name> [--starter-credits <n>]");
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

const rawUrl = process.env.DATABASE_URL?.trim();
if (!rawUrl) {
  console.error("BLOCKED — DATABASE_URL is not configured.");
  process.exit(2);
}

const sql = neon(rawUrl);
const organizationId = crypto.randomUUID();
const userId = crypto.randomUUID();

const existingOrg = await sql`select id, name from organizations where slug = ${slug}`;
const resolvedOrgId = existingOrg[0]?.id || organizationId;
if (existingOrg[0]) {
  console.log(`Organization "${slug}" already exists (${existingOrg[0].id}, "${existingOrg[0].name}") — reusing it.`);
} else {
  await sql`insert into organizations (id, slug, name, active) values (${organizationId}, ${slug}, ${name}, true)`;
  console.log(`Created organization "${name}" (${organizationId}, slug "${slug}").`);
}

// The first HR account for a new client gets full permissions — they are the
// only person on their tenant until they invite others via the existing
// user-directory flow. Full permissions are scoped entirely to their own
// organizationId; they can never see or act on another tenant's data.
await sql`
  insert into users (id, organization_id, email, full_name, access_role, can_create_role, can_review_role, can_approve_role, can_edit_settings, can_manage_users, can_review_department_role, active)
  values (${userId}, ${resolvedOrgId}, ${adminEmail}, ${adminName}, 'Admin', true, true, true, true, true, true, true)
  on conflict (email) do nothing
`;

await sql`
  insert into organization_memberships (organization_id, email, active)
  values (${resolvedOrgId}, ${adminEmail}, true)
  on conflict (organization_id, email) do update set active = true, updated_at = now()
`;

await sql`
  insert into credit_accounts (organization_id, owner_email, balance)
  values (${resolvedOrgId}, ${adminEmail}, ${starterCredits})
  on conflict (organization_id, owner_email) do nothing
`;

const summary = await sql`
  select o.id as organization_id, o.slug, o.name,
         u.id as user_id, u.email as admin_email, u.access_role,
         m.active as membership_active,
         ca.balance as credit_balance
  from organizations o
  left join users u on u.organization_id = o.id and u.email = ${adminEmail}
  left join organization_memberships m on m.organization_id = o.id and m.email = ${adminEmail}
  left join credit_accounts ca on ca.organization_id = o.id and ca.owner_email = ${adminEmail}
  where o.id = ${resolvedOrgId}
`;

console.log(JSON.stringify(summary[0], null, 2));
console.log(`Done. ${adminName} <${adminEmail}> can now log in with Google (must sign in with this exact email) and lands in organization "${slug}".`);
