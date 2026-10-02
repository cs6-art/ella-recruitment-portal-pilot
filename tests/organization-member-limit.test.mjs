import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SELF_SERVICE_MEMBER_LIMIT, isMemberLimitReached, memberSeatUsage } from "../src/lib/organization-signup.ts";

const read = (path) => readFileSync(path, "utf8");
const registration = read("src/lib/registration.ts");
const registerRoute = read("src/app/api/auth/register/route.ts");
const invites = read("src/app/api/organizations/team-invites/route.ts");
const organizations = read("src/app/api/organizations/route.ts");
const editor = read("src/components/UserAccountsEditor.tsx");
const homePage = read("src/app/page.tsx");
const schema = read("src/db/schema.ts");
const migration = read("drizzle/0037_organization_member_limit.sql");

test("a self-service organization starts with a limit of 5 people", () => {
  assert.equal(SELF_SERVICE_MEMBER_LIMIT, 5);
  assert.match(registration, /maxMembers: SELF_SERVICE_MEMBER_LIMIT/);
});

test("the limit is reached at exactly the limit, and no limit means unlimited", () => {
  assert.equal(isMemberLimitReached(5, 4), false);
  assert.equal(isMemberLimitReached(5, 5), true);
  assert.equal(isMemberLimitReached(5, 9), true);
  assert.equal(isMemberLimitReached(null, 500), false);
  assert.equal(isMemberLimitReached(undefined, 500), false);
  assert.equal(isMemberLimitReached(1, 0), false);
});

test("active people, pending registrations, and invitations share one seat count", () => {
  assert.equal(memberSeatUsage({ activeEmails: ["owner@mctest.com", "hr@mctest.com"], invitedEmails: ["invite@mctest.com"], pendingEmails: ["pending@mctest.com", "hr@mctest.com"] }), 4);
  assert.equal(memberSeatUsage({ activeEmails: ["owner@mctest.com"], invitedEmails: ["me@mctest.com"], pendingEmails: ["me@mctest.com"], currentEmail: "me@mctest.com" }), 1);
});

test("the limit is stored per organization, optional, and never negative or zero", () => {
  assert.match(schema, /maxMembers: integer\("max_members"\)/);
  assert.doesNotMatch(schema, /max_members"\)\.notNull/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "max_members" integer/);
  assert.match(migration, /"max_members" IS NULL OR "max_members" >= 1/);
});

test("registering into a full organization is refused with a plain message", () => {
  const registerBody = registration.slice(registration.indexOf("export async function registerUser"), registration.indexOf("export async function reissueVerification"));
  assert.match(registerBody, /organizationIsFull\(organizationId, input\.email\)/);
  assert.match(registerRoute, /result\.status === "organization_full"/);
  assert.match(registerRoute, /reached its limit on the number of people/);
});

test("the limit is checked again at verification and the link stays usable", () => {
  const verifyBody = registration.slice(registration.indexOf("export async function verifyRegistration"), registration.indexOf("async function ensureDirectoryUser"));
  const full = verifyBody.indexOf("organizationIsFull(organizationId, row.email)");
  assert.ok(full > -1);
  // It returns before the credential is marked verified, so the token is not used up.
  assert.ok(full < verifyBody.indexOf("emailVerifiedAt"));
  assert.match(homePage, /organization_full: "Your organization has reached its limit/);
});

test("someone who already belongs to the organization is never turned away by the limit", () => {
  assert.match(registration, /currentEmail: email/);
  assert.match(registration, /memberSeatUsage/);
});

test("only active people count, so deactivating someone frees a place", () => {
  assert.match(registration, /eq\(users\.active, true\)/);
  assert.match(invites, /eq\(users\.active, true\)/);
  assert.match(registration, /userCredentials\.emailVerifiedAt} IS NULL/);
  assert.match(invites, /userCredentials\.emailVerifiedAt} IS NULL/);
});

test("owners cannot invite past the limit, counting invitations still waiting", () => {
  assert.match(invites, /isMemberLimitReached\(organization\.maxMembers, used\)/);
  assert.match(invites, /memberSeatUsage/);
  assert.match(invites, /Your organization is limited to \$\{organization\.maxMembers\} people\. Contact McLink support to raise the limit\./);
  assert.match(invites, /limit: organization\.maxMembers/);
});

test("McLink administrators can set, change or remove the limit; owners cannot", () => {
  // Only the platform administrator guard protects this route.
  assert.match(organizations, /requirePlatformAdmin/);
  assert.match(organizations, /maxMembers: z\.number\(\)\.int\([^)]*\)\.min\(1[^)]*\)\.max\(100000\)\.nullable\(\)\.optional\(\)/);
  assert.match(organizations, /maxMembers: input\.maxMembers \?\? null/);
  // Leaving it out of an update keeps the current limit; null removes it.
  assert.match(organizations, /input\.maxMembers === undefined \? \{\} : \{ maxMembers: input\.maxMembers \}/);
  assert.match(organizations, /memberCount/);
  assert.doesNotMatch(invites, /maxMembers:\s*z\./);
});

test("the Organizations screen has a Member limit box and shows how many people each organization has", () => {
  assert.match(editor, /htmlFor="organization-max-members">Member limit</);
  assert.match(editor, /maxMembers: limitText \? Number\(limitText\) : null/);
  assert.match(editor, /Leave blank for no limit/);
  assert.match(editor, /of \$\{organization\.maxMembers\} people/);
  assert.match(editor, /Your organization has \{inviteUsed\} of \{inviteLimit\} people/);
});

test("a registration whose confirmation link has expired no longer holds a place", () => {
  const countedPending = "sql`${userCredentials.emailVerifiedAt} IS NULL`, sql`${userCredentials.verificationExpiresAt} > now()`";
  assert.equal(registration.split(countedPending).length - 1, 1);
  assert.equal(invites.split(countedPending).length - 1, 2);
  // Resending a link must still work for an expired, unconfirmed registration.
  const reissue = registration.slice(registration.indexOf("export async function reissueVerification"), registration.indexOf("export type VerifyResult"));
  assert.doesNotMatch(reissue, /verificationExpiresAt\} > now\(\)/);
});
