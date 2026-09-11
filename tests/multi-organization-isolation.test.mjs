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

test("per-user credit operations always carry both tenant and owner scope", () => {
  const credits = read("src/lib/ella-credits.ts");
  const accounts = read("src/lib/ella-credits-accounts.ts");
  assert.match(accounts, /WHERE "organization_id" = \$\{orgId\} AND "owner_email" = \$\{owner\}/);
  assert.match(accounts, /FOR UPDATE/);
  assert.match(accounts, /credit_account_ledger/);
  assert.match(credits, /An organization and owner are required for per-user credits/);
  assert.match(credits, /ownerEmail: input\.actorEmail/);
});

test("sessions and login resolve an organization before tenant-scoped requests", () => {
  const session = read("src/lib/session.ts");
  const auth = read("src/app/api/auth/google/route.ts");
  const target = read("src/lib/recruitment-target-portal.ts");
  assert.match(session, /!user\.organizationId/);
  assert.match(auth, /resolveOrganizationForLogin/);
  assert.match(auth, /organizationId,/);
  assert.match(target, /rowOrganizationId\(row\.application\) === organizationId/);
  assert.match(target, /targetPublicRoleDetails/);
});

test("directory provisioning cannot grant a user access to another tenant", () => {
  const directory = read("src/app/api/user-directory/route.ts");
  const orgs = read("src/lib/organization-accounts.ts");
  assert.match(directory, /organizationId: access\.user\.organizationId/);
  assert.match(orgs, /current tenant/);
  assert.match(orgs, /previousEmail/);
});

test("applicants cannot be reused across organizations", () => {
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(queries, /applicant_belongs_to_another_organization/);
  assert.match(queries, /existingApplicant\.organizationId !== role\.organizationId/);
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
