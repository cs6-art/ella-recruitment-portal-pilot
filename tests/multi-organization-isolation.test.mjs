import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Pilot provisions a tenant and independent seeded credit accounts", () => {
  const migration = read("drizzle/0010_multi_organization_accounts.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "organizations"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "organization_memberships"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "credit_accounts"/);
  assert.match(migration, /cs6@mclinkgroup\.com'[\s\S]*300/);
  assert.match(migration, /cs9@mclinkgroup\.com'[\s\S]*300/);
  assert.match(migration, /ON CONFLICT \("organization_id", "owner_email"\) DO NOTHING/);
});

test("credit operations use one shared wallet per tenant", () => {
  const credits = read("src/lib/ella-credits.ts");
  const accounts = read("src/lib/ella-credits-accounts.ts");
  assert.match(accounts, /return "org"/);
  assert.match(accounts, /WHERE "organization_id" = \$\{orgId\} AND "owner_email" = \$\{owner\}/);
  assert.match(accounts, /ownerEmail: string/);
  assert.match(accounts, /credit_account_ledger/);
  assert.match(credits, /one shared balance inside the signed-in user's organization/);
  assert.match(credits, /ownerEmail: "org"/);
});

test("sessions and login resolve an organization before tenant-scoped requests", () => {
  const session = read("src/lib/session.ts");
  const auth = read("src/app/api/auth/google/route.ts");
  const target = read("src/lib/recruitment-target-portal.ts");
  assert.match(session, /!user\.organizationId/);
  assert.match(auth, /resolveOrganizationForLogin/);
  assert.match(auth, /organizationId,/);
  assert.match(target, /listApplications\(undefined, undefined, organizationId\)/);
  assert.match(target, /targetPublicRoleDetails/);
});

test("directory provisioning cannot grant a user access to another tenant", () => {
  const directory = read("src/app/api/user-directory/route.ts");
  const orgs = read("src/lib/organization-accounts.ts");
  assert.match(directory, /organizationId: target\.organizationId/);
  assert.match(directory, /isPlatformAdmin/);
  assert.match(orgs, /current tenant/);
  assert.match(orgs, /previousEmail/);
});

test("client organizations can log in without a row in McLink's own user directory", () => {
  const auth = read("src/app/api/auth/google/route.ts");
  const directory = read("src/lib/postgres-directory.ts");
  assert.match(auth, /findPostgresDirectoryUser/);
  assert.match(auth, /findPostgresDirectoryUserByEmail/);
  assert.match(auth, /The directory, not the Google hosted domain/);
  // The Postgres fallback must never run for the default (McLink) organization
  // — the Sheet-only login path for existing McLink staff stays untouched.
  assert.match(directory, /from\(users\)\s*\.innerJoin\(organizations/);
  assert.match(directory, /eq\(users\.organizationId, organizationId\)/);
});

test("deactivated McLink identities can resolve to an active client tenant", () => {
  const auth = read("src/app/api/auth/google/route.ts");
  assert.match(auth, /sheetDirectoryUser\?\.active === true/);
});

test("user identities are unique within a tenant and McLink login wins for shared test identities", () => {
  const schema = read("src/db/schema-recruitment.ts");
  const migration = read("drizzle/0016_tenant_user_identity.sql");
  const directory = read("src/lib/postgres-directory.ts");
  const orgs = read("src/lib/organization-accounts.ts");
  assert.doesNotMatch(schema, /email: text\("email"\)\.notNull\(\)\.unique\(\)/);
  assert.match(schema, /users_organization_email_uidx/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS "users_email_key"/);
  assert.match(migration, /ON "users" \("organization_id", "email"\)/);
  assert.match(directory, /eq\(users\.organizationId, organizationId\)/);
  assert.match(orgs, /if \(hasDefaultDirectoryUser\) return DEFAULT_ORGANIZATION_ID/);
});

test("a new organization and its first user are self-service, no separate database needed", () => {
  const organizationsRoute = read("src/app/api/organizations/route.ts");
  const orgs = read("src/lib/organization-accounts.ts");
  const directory = read("src/lib/postgres-directory.ts");
  // Creating an organization needs nothing but a name/slug from a platform admin.
  assert.match(organizationsRoute, /requirePlatformAdmin/);
  assert.match(organizationsRoute, /insert\(organizations\)/);
  // Its first (and every later) user is created through the same directory
  // upsert every organization uses -- no separate provisioning script.
  assert.match(directory, /export async function upsertPostgresDirectoryUser/);
  // Tenant provisioning creates exactly one shared wallet, irrespective of
  // which user triggered membership synchronization.
  assert.match(orgs, /insert\(creditAccounts\)/);
  assert.match(orgs, /creditOwner = "org"/);
  assert.match(orgs, /onConflictDoNothing\(\{ target: creditAccounts\.organizationId \}\)/);
});

test("shared wallet repair preserves balances and reattaches ledger history", () => {
  const migration = read("drizzle/0019_restore_shared_credit_accounts.sql");
  assert.match(migration, /sum\("balance"\)/);
  assert.match(migration, /UPDATE "credit_account_ledger"/);
  assert.match(migration, /DELETE FROM "credit_accounts"/);
  assert.match(migration, /owner_email.*= 'org'/);
  assert.match(migration, /credit_accounts_organization_uidx/);
});

test("applicants are deduplicated inside each organization", () => {
  const queries = read("src/lib/internal-recruitment-queries.ts");
  const migration = read("drizzle/0013_tenant_scoped_uniqueness.sql");
  assert.match(queries, /eq\(applicants\.organizationId, role\.organizationId\)/);
  assert.match(queries, /target: \[applicants\.organizationId, applicants\.primaryEmail\]/);
  assert.match(migration, /applicants_organization_primary_email_uidx/);
});

test("resume and booking writes carry the application tenant", () => {
  const queries = read("src/lib/internal-recruitment-queries.ts");
  const portal = read("src/lib/recruitment-target-portal.ts");
  const hrIntake = read("src/app/api/applicants/route.ts");
  const publicIntake = read("src/app/api/public/applications/route.ts");
  const schemaMigration = read("drizzle/0010_multi_organization_accounts.sql");
  assert.match(schemaMigration, /ALTER TABLE "resume_files" ADD COLUMN IF NOT EXISTS "organization_id" uuid/);
  assert.match(schemaMigration, /ALTER TABLE "booking_tokens" ADD COLUMN IF NOT EXISTS "organization_id" uuid/);
  assert.match(schemaMigration, /ALTER TABLE "resume_files" ALTER COLUMN "organization_id" SET NOT NULL/);
  assert.match(schemaMigration, /ALTER TABLE "booking_tokens" ALTER COLUMN "organization_id" SET NOT NULL/);
  assert.match(queries, /resumeFiles\)\.values\(\{ organizationId/);
  assert.match(queries, /bookingTokens\)\.values\(\{ organizationId: application\.organizationId/);
  assert.match(portal, /const roleOrganizationId = rowOrganizationId\(role\)/);
  assert.match(portal, /input\.organizationId\?\.trim\(\) && input\.organizationId\.trim\(\) !== roleOrganizationId/);
  assert.match(hrIntake, /organizationId: user\.organizationId/);
  assert.match(hrIntake, /extractedText: storedResume\.extractedText/);
  assert.doesNotMatch(hrIntake, /responseError\(error instanceof Error \? error\.message/);
  assert.doesNotMatch(publicIntake, /responseError\(request, error instanceof Error \? error\.message/);
});

test("tenant columns are protected by database foreign keys", () => {
  const migration = read("drizzle/0012_tenant_directory_integrity.sql");
  for (const table of ["departments", "users", "roles", "applicants", "applications", "screening_results", "interview_slots", "voice_call_attempts", "voice_interview_results", "voice_call_logs", "booking_tokens", "application_status_history"]) {
    assert.match(migration, new RegExp(`ALTER TABLE \\"${table}\\"[\\s\\S]*FOREIGN KEY \\(\\"organization_id\\"\\) REFERENCES \\"organizations\\"`, "i"), `missing tenant FK for ${table}`);
  }
});
