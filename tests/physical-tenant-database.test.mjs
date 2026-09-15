import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Renamed in spirit from "physical tenant database" (a per-org separate
// Postgres database, provisioned by hand) to "shared tenant database" -- that
// upgrade path was never wired up (a static env var the running app never
// re-read) and nothing used it, so it was removed rather than fixed. Every
// organization shares one physical database and is isolated by the
// `organization_id` column alone; a new org is fully usable the moment it
// (and its first user) are created, with no extra provisioning step.

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("organizations is the tenant registry, not a physical-database map", () => {
  const migration = read("drizzle/0014_physical_tenant_databases.sql");
  const schema = read("src/db/schema.ts");
  assert.match(migration, /database_key/);
  assert.match(migration, /database_status/);
  assert.match(migration, /organizations_database_key_uidx/);
  assert.match(schema, /databaseKey: text\("database_key"\)/);
  assert.match(schema, /databaseStatus: text\("database_status"\)/);
});

test("tenant context is request-local and every organization shares one database", () => {
  const router = read("src/lib/tenant-database.ts");
  const client = read("src/db/client.ts");
  assert.match(router, /AsyncLocalStorage/);
  assert.match(router, /DEFAULT_ORGANIZATION_ID/);
  assert.match(router, /process\.env\.DATABASE_URL\?\.trim\(\)/);
  assert.doesNotMatch(router, /TENANT_DATABASE_URLS/);
  assert.match(client, /getTenantDb/);
  assert.match(client, /tenantDatabaseUrl/);
});

test("a new organization needs no separate database provisioning", () => {
  const route = read("src/app/api/organizations/route.ts");
  assert.match(route, /insert\(organizations\)/);
  assert.doesNotMatch(route, /TENANT_DATABASE_URLS/);
});

test("internal automation requires an explicit tenant header for client data", () => {
  const internal = read("src/lib/internal-api-http.ts");
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(internal, /x-organization-id/);
  assert.match(internal, /tenant_database_not_configured/);
  assert.match(queries, /getTenantDb as getDb/);
});

test("public Postgres role pages and intake search every active organization", () => {
  const portal = read("src/lib/recruitment-target-portal.ts");
  const roles = read("src/app/api/public/roles/route.ts");
  const page = read("src/app/apply/[roleId]/page.tsx");
  assert.match(portal, /activeTenantOrganizationIds/);
  assert.match(portal, /targetPublicRoleSummaries/);
  assert.match(roles, /targetPublicRoleSummaries/);
  assert.match(page, /resolvePublishedRecruitmentRole/);
});

test("organization administration is restricted to the McLink platform admin", () => {
  const route = read("src/app/api/organizations/route.ts");
  const directory = read("src/app/api/user-directory/route.ts");
  const editor = read("src/components/UserAccountsEditor.tsx");
  assert.match(route, /Only a McLink platform administrator/);
  assert.match(route, /A provisioned organization cannot change its slug/);
  assert.match(directory, /organizationId/);
  assert.match(directory, /runWithTenantDatabase/);
  assert.match(editor, /\/api\/organizations/);
  assert.match(editor, /Manage users for/);
  assert.match(editor, /Every organization shares one database/);
});
