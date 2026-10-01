import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  emailDomain,
  isDomainClaimed,
  isPersonalEmailDomain,
  isReservedOrganizationDomain,
  organizationNameFromDomain,
  organizationSlugFromDomain,
} from "../src/lib/organization-signup.ts";

const registration = readFileSync("src/lib/registration.ts", "utf8");
const registerRoute = readFileSync("src/app/api/auth/register/route.ts", "utf8");
const loginRoute = readFileSync("src/app/api/auth/login/route.ts", "utf8");
const migration = readFileSync("drizzle/0036_self_service_organizations.sql", "utf8");

test("personal mailboxes can never start an organization", () => {
  for (const domain of ["gmail.com", "Yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "proton.me", "mailinator.com"]) {
    assert.equal(isPersonalEmailDomain(domain), true, domain);
  }
  assert.equal(isPersonalEmailDomain("mctest.com"), false);
});

test("the email domain is read case-insensitively", () => {
  assert.equal(emailDomain("Person@McTest.COM"), "mctest.com");
  assert.equal(emailDomain("no-at-sign"), "");
});

test("a domain is claimed by an organization's domain list or by an invited address on it", () => {
  const rules = [
    { allowedDomains: ["acme.com"], allowedEmails: [] },
    { allowedDomains: [], allowedEmails: ["lead@globex.com"] },
  ];
  assert.equal(isDomainClaimed("acme.com", rules), true);
  assert.equal(isDomainClaimed("@ACME.com", rules), true);
  assert.equal(isDomainClaimed("globex.com", rules), true);
  assert.equal(isDomainClaimed("mctest.com", rules), false);
  assert.equal(isDomainClaimed("evil-acme.com", rules), false);
});

test("the new organization's name and web address come from the company domain", () => {
  assert.equal(organizationNameFromDomain("mctest.com"), "Mctest");
  assert.equal(organizationNameFromDomain("acme-corp.com"), "Acme Corp");
  assert.equal(organizationNameFromDomain("acme.com.ph"), "Acme");
  assert.equal(organizationNameFromDomain("hr.acme.co.uk"), "Acme");
  assert.equal(organizationSlugFromDomain("mctest.com"), "mctest");
  assert.equal(organizationSlugFromDomain("Acme-Corp.com"), "acme-corp");
  assert.equal(organizationSlugFromDomain("acme.com.sg"), "acme");
  assert.match(organizationSlugFromDomain("x.com"), /^[a-z0-9][a-z0-9-]{1,62}$/);
});

test("platform organization names are reserved for self-service sign-up", () => {
  assert.equal(isReservedOrganizationDomain("mclinkgroup.com"), true);
  assert.equal(isReservedOrganizationDomain("anything.xyz"), false);
});

test("registration starts a new organization only for an unowned company domain", () => {
  assert.match(registration, /resolveNewOrganizationDomain/);
  assert.match(registration, /isPersonalEmailDomain\(domain\)\) return "personal"/);
  assert.match(registration, /isDomainClaimed\(domain, rules\) \? "not_eligible" : "new"/);
  // An existing organization's own rules are always tried first.
  assert.ok(registration.indexOf("resolveRegistrationOrganization(input.email)") < registration.indexOf("resolveNewOrganizationDomain(input.email)"));
});

test("the organization is created only after the email is verified, and the credential waits without one", () => {
  const registerBody = registration.slice(registration.indexOf("export async function registerUser"), registration.indexOf("export async function reissueVerification"));
  assert.doesNotMatch(registerBody, /createOrganizationForDomain/);
  const verifyBody = registration.slice(registration.indexOf("export async function verifyRegistration"), registration.indexOf("async function ensureDirectoryUser"));
  assert.match(verifyBody, /createOrganizationForDomain\(emailDomain\(row\.email\), row\.email\)/);
  // A colleague who verified first has already created it: join instead of creating a second one.
  assert.ok(verifyBody.indexOf("resolveRegistrationOrganization(row.email)") < verifyBody.indexOf("createOrganizationForDomain"));
  assert.match(migration, /ALTER COLUMN "organization_id" DROP NOT NULL/);
});

test("the new organization lets anyone on the company domain join, and the first verified person owns it", () => {
  assert.match(registration, /allowedDomains: \[domain\], allowedEmails: \[\]/);
  assert.match(registration, /onboardingStartedAt: new Date\(\)/);
  assert.match(registration, /Organization_Display_Name/);
  assert.match(registration, /claimOrganizationOwnershipIfNone\(organizationId, email\)/);
});

test("the McLink organization name can never be taken by a self-service sign-up", () => {
  assert.match(registration, /isReservedOrganizationDomain\(domain\)/);
  assert.match(registration, /RESERVED_ORGANIZATION_SLUGS/);
});

test("simultaneous first confirmations join the organization created by the first one", () => {
  assert.match(registration, /resolveRegistrationOrganization\(`probe@\$\{domain\}`\)/);
  assert.match(registration, /instead of creating a duplicate/);
});

test("people are told clearly why a registration was refused", () => {
  assert.match(registerRoute, /result\.status === "personal_email"/);
  assert.match(registerRoute, /Use your work email address/);
  assert.match(registerRoute, /Ask your organization's owner to invite you/);
  assert.doesNotMatch(registerRoute, /limited to members of a participating organization/);
});

test("a credential with no organization cannot log in", () => {
  assert.match(loginRoute, /if \(!credential\.organizationId\) return NextResponse\.json\(\{ error: "Please verify your email first/);
});

test("the registration page explains the new work-email flow", () => {
  const page = readFileSync("src/app/page.tsx", "utf8");
  assert.match(page, /Use your work email address/);
  assert.doesNotMatch(page, /Organization members only/);
});
