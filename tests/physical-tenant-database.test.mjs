import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("organizations is the physical-database control-plane registry", () => {
  const migration = read("drizzle/0014_physical_tenant_databases.sql");
  const schema = read("src/db/schema.ts");
  assert.match(migration, /database_key/);
  assert.match(migration, /database_status/);
  assert.match(migration, /organizations_database_key_uidx/);
  assert.match(schema, /databaseKey: text\("database_key"\)/);
  assert.match(schema, /databaseStatus: text\("database_status"\)/);
});

test("tenant database routing is request-local and keeps McLink as the default", () => {
  const router = read("src/lib/tenant-database.ts");
  const client = read("src/db/client.ts");
  assert.match(router, /AsyncLocalStorage/);
  assert.match(router, /TENANT_DATABASE_URLS/);
  assert.match(router, /DEFAULT_ORGANIZATION_ID/);
  assert.match(router, /process\.env\.DATABASE_URL\?\.trim\(\)/);
  assert.match(client, /getTenantDb/);
  assert.match(client, /tenantDatabaseUrl/);
});

test("client provisioning migrates and seeds a separate database", () => {
  const provision = read("src/db/provision-client-organization.mjs");
  assert.match(provision, /--database-url/);
  assert.match(provision, /DATABASE_URL/);
  assert.match(provision, /migrateScript/);
  assert.match(provision, /tenantSql/);
  assert.match(provision, /different physical database/);
});

test("internal automation requires an explicit tenant header for client data", () => {
  const internal = read("src/lib/internal-api-http.ts");
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(internal, /x-organization-id/);
  assert.match(internal, /tenant_database_not_configured/);
  assert.match(queries, /getTenantDb as getDb/);
});

test("public Postgres role pages and intake search configured tenant databases", () => {
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
  assert.match(route, /databaseStatus: "shared"/);
  assert.match(route, /A provisioned organization cannot change its slug/);
  assert.match(directory, /organizationId/);
  assert.match(directory, /runWithTenantDatabase/);
  assert.match(editor, /\/api\/organizations/);
  assert.match(editor, /Manage users for/);
  assert.match(editor, /Shared database/);
});
