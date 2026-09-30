import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("migration allows one owner per organization and backfills client organizations only", () => {
  const sql = read("drizzle/0033_organization_owner.sql");
  assert.match(sql, /users_one_owner_per_org_uidx[\s\S]*WHERE "is_organization_owner"/);
  assert.match(sql, /<> '00000000-0000-4000-8000-000000000001'/);
});

test("first registrant of a client organization claims ownership", () => {
  const registration = read("src/lib/registration.ts");
  assert.match(registration, /organizationId !== DEFAULT_ORGANIZATION_ID\) await claimOrganizationOwnershipIfNone/);
});

test("team management is limited to the owner, the owner is protected, and the last account is kept", () => {
  const api = read("src/app/api/user-directory/route.ts");
  assert.match(api, /Only the organization owner can manage team members\./);
  assert.match(api, /The organization owner cannot be deactivated/);
  assert.match(api, /You cannot deactivate the last active account\./);
  assert.match(api, /platformAdmin && user\.isOrganizationOwner === true/);
});

test("owners invite teammates by individual email only; domains stay with platform administrators", () => {
  const api = read("src/app/api/organizations/team-invites/route.ts");
  assert.match(api, /Only the organization owner can invite teammates\./);
  assert.match(api, /isOrganizationOwner, true/);
  assert.match(api, /already belongs to another organization/);
  assert.doesNotMatch(api, /allowedDomains: \[/, "an owner must never be able to write domains");
  assert.match(api, /Deactivate them from the team list instead/);
});
