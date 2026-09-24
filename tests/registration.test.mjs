import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("src/lib/registration.ts", "utf8");
const migration = fs.readFileSync("drizzle/0025_user_registration.sql", "utf8");

// Extract the pure matcher so it can be exercised without a database.
const matcher = source.match(/export function matchRegistrationOrganization[\s\S]*?\r?\n}\r?\n/)[0]
  .replace("export function", "function").replace(/: string \| null/, "").replace(/\(email: string, rules: OrganizationRule\[\]\)/, "(email, rules)");
const normalize = 'const normalizeEmail = (v) => typeof v === "string" ? v.trim().toLowerCase() : "";';
const matchRegistrationOrganization = new Function(`${normalize}\n${matcher}\nreturn matchRegistrationOrganization;`)();

const rules = [
  { id: "mclink", allowedDomains: ["mclinkgroup.com"], allowedEmails: [] },
  { id: "mcprint", allowedDomains: [], allowedEmails: ["bong041026@gmail.com", "lihenb263@gmail.com", "padillajuliojose@gmail.com"] },
];

test("registration is restricted to organization domains and allow-listed emails", () => {
  assert.equal(matchRegistrationOrganization("Staff@MCLinkGroup.com", rules), "mclink");
  assert.equal(matchRegistrationOrganization("lihenb263@gmail.com", rules), "mcprint");
  assert.equal(matchRegistrationOrganization("stranger@gmail.com", rules), null);
  assert.equal(matchRegistrationOrganization("x@evil-mclinkgroup.com", rules), null);
});

test("an ambiguous match fails closed", () => {
  const both = [...rules, { id: "other", allowedDomains: ["mclinkgroup.com"], allowedEmails: [] }];
  assert.equal(matchRegistrationOrganization("a@mclinkgroup.com", both), null);
});

test("passwords are hashed and verification tokens are stored hashed with an expiry", () => {
  assert.match(source, /crypto\.scrypt/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /verificationTokenHash: hashToken\(token\)/);
  assert.match(source, /verificationExpiresAt/);
  assert.match(source, /resetTokenHash: hashToken\(token\)/);
  assert.match(migration, /"password_hash" text NOT NULL/);
});

test("verification never overwrites an existing directory row", () => {
  assert.match(source, /findDirectoryUser\(email\)\)\) return/);
  assert.match(source, /findPostgresDirectoryUser\(email, organizationId\)\) return/);
});
