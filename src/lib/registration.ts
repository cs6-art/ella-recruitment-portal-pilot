import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { organizations, userCredentials } from "@/db/schema";
import { HR_FULL_ACCESS } from "@/lib/access-roles";
import { findDirectoryUser, type DirectoryUser } from "@/lib/google-sheets";
import { DEFAULT_ORGANIZATION_ID, syncOrganizationMembership } from "@/lib/organization-accounts";
import { findPostgresDirectoryUser, upsertPostgresDirectoryUser } from "@/lib/postgres-directory";
import { runWithTenantDatabase } from "@/lib/tenant-database";
import { fetchWithTimeout, timeoutFromEnv } from "@/lib/fetch-with-timeout";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const SCRYPT_KEYLEN = 64;

export function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isPlausibleEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string") return "Password is required.";
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  return null;
}

// --- Password hashing (scrypt, no extra dependency) -------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltValue, hashValue] = stored.split("$");
  if (scheme !== "scrypt" || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = await scrypt(password, Buffer.from(saltValue, "base64url"));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Burn the same CPU as a real check so unknown emails are not distinguishable by timing. */
export async function verifyAgainstDummyHash(password: string) {
  await scrypt(password, Buffer.alloc(16));
}

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

// --- Organization registration rules ---------------------------------------

type OrganizationRule = { id: string; allowedDomains: string[]; allowedEmails: string[] };

/**
 * Decide which organization an email may register into. An explicitly
 * allow-listed address wins over a domain match. If the email matches more
 * than one organization the result is ambiguous and registration fails closed.
 */
export function matchRegistrationOrganization(email: string, rules: OrganizationRule[]): string | null {
  const normalized = normalizeEmail(email);
  const domain = normalized.split("@")[1] || "";
  if (!normalized || !domain) return null;

  const byEmail = rules.filter((rule) => rule.allowedEmails.some((allowed) => normalizeEmail(allowed) === normalized));
  if (byEmail.length) return byEmail.length === 1 ? byEmail[0].id : null;

  const byDomain = rules.filter((rule) => rule.allowedDomains.some((allowed) => allowed.trim().toLowerCase().replace(/^@/, "") === domain));
  return byDomain.length === 1 ? byDomain[0].id : null;
}

export async function resolveRegistrationOrganization(email: string): Promise<string | null> {
  const rows = await getDb()
    .select({ id: organizations.id, allowedDomains: organizations.allowedDomains, allowedEmails: organizations.allowedEmails })
    .from(organizations)
    .where(eq(organizations.active, true));
  return matchRegistrationOrganization(email, rows);
}

// --- Registration + verification -------------------------------------------

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export type RegisterResult =
  | { status: "created"; token: string; organizationId: string }
  | { status: "not_eligible" }
  | { status: "already_registered" };

/**
 * Create (or re-issue, if still unverified) a credential for an eligible
 * email and return a fresh verification token. The password of an unverified
 * registration may be replaced, because nobody can log in until the mailbox
 * owner clicks the emailed link.
 */
export async function registerUser(input: { email: string; fullName: string; password: string }): Promise<RegisterResult> {
  const organizationId = await resolveRegistrationOrganization(input.email);
  if (!organizationId) return { status: "not_eligible" };

  const db = getDb();
  const [existing] = await db.select({ id: userCredentials.id, verifiedAt: userCredentials.emailVerifiedAt }).from(userCredentials).where(eq(userCredentials.email, input.email)).limit(1);
  if (existing?.verifiedAt) return { status: "already_registered" };

  const token = crypto.randomBytes(32).toString("base64url");
  const values = {
    organizationId,
    fullName: input.fullName,
    passwordHash: await hashPassword(input.password),
    verificationTokenHash: hashToken(token),
    verificationExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    updatedAt: new Date(),
  };
  if (existing) await db.update(userCredentials).set(values).where(eq(userCredentials.id, existing.id));
  else await db.insert(userCredentials).values({ email: input.email, ...values });
  return { status: "created", token, organizationId };
}

/** Issue a new token for an unverified account (resend). Returns null when there is nothing to resend. */
export async function reissueVerification(email: string): Promise<{ token: string; fullName: string } | null> {
  const db = getDb();
  const token = crypto.randomBytes(32).toString("base64url");
  const [row] = await db
    .update(userCredentials)
    .set({ verificationTokenHash: hashToken(token), verificationExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS), updatedAt: new Date() })
    .where(and(eq(userCredentials.email, email), sql`${userCredentials.emailVerifiedAt} IS NULL`))
    .returning({ fullName: userCredentials.fullName });
  return row ? { token, fullName: row.fullName } : null;
}

export type VerifyResult = { status: "verified" | "invalid" | "expired" };

/**
 * Consume a verification token, mark the email verified, and provision the
 * account in its organization: a membership plus a least-privilege directory
 * row. An existing directory row (McLink staff in the Sheet, or a Postgres
 * row created by HR) is never overwritten, so previously granted access is
 * preserved.
 */
export async function verifyRegistration(token: string): Promise<VerifyResult> {
  if (!token || token.length > 200) return { status: "invalid" };
  const db = getDb();
  const [row] = await db
    .select()
    .from(userCredentials)
    .where(eq(userCredentials.verificationTokenHash, hashToken(token)))
    .limit(1);
  if (!row) return { status: "invalid" };
  if (!row.verificationExpiresAt || row.verificationExpiresAt.getTime() < Date.now()) return { status: "expired" };

  await db
    .update(userCredentials)
    .set({ emailVerifiedAt: row.emailVerifiedAt ?? new Date(), verificationTokenHash: null, verificationExpiresAt: null, updatedAt: new Date() })
    .where(eq(userCredentials.id, row.id));

  await syncOrganizationMembership({ organizationId: row.organizationId, email: row.email, active: true });
  await ensureDirectoryUser(row.organizationId, row.email, row.fullName);
  return { status: "verified" };
}

async function ensureDirectoryUser(organizationId: string, email: string, fullName: string) {
  if (organizationId === DEFAULT_ORGANIZATION_ID && (await findDirectoryUser(email))) return;
  await runWithTenantDatabase(organizationId, async () => {
    if (await findPostgresDirectoryUser(email, organizationId)) return;
    await upsertPostgresDirectoryUser(organizationId, {
      email,
      fullName,
      accessRole: "HR",
      department: "",
      ...HR_FULL_ACCESS,
      active: true,
    });
  });
}

// --- Password reset ---------------------------------------------------------

const RESET_TTL_MS = 60 * 60 * 1000;

/** Issue a reset token for a verified account; null when the email has no verified account. */
export async function issuePasswordReset(email: string): Promise<{ token: string; fullName: string } | null> {
  const token = crypto.randomBytes(32).toString("base64url");
  const [row] = await getDb()
    .update(userCredentials)
    .set({ resetTokenHash: hashToken(token), resetExpiresAt: new Date(Date.now() + RESET_TTL_MS), updatedAt: new Date() })
    .where(and(eq(userCredentials.email, email), sql`${userCredentials.emailVerifiedAt} IS NOT NULL`))
    .returning({ fullName: userCredentials.fullName });
  return row ? { token, fullName: row.fullName } : null;
}

export async function resetPassword(token: string, password: string): Promise<"reset" | "invalid" | "expired"> {
  if (!token || token.length > 200) return "invalid";
  const db = getDb();
  const [row] = await db.select({ id: userCredentials.id, expiresAt: userCredentials.resetExpiresAt }).from(userCredentials).where(eq(userCredentials.resetTokenHash, hashToken(token))).limit(1);
  if (!row) return "invalid";
  if (!row.expiresAt || row.expiresAt.getTime() < Date.now()) return "expired";
  await db.update(userCredentials).set({ passwordHash: await hashPassword(password), resetTokenHash: null, resetExpiresAt: null, updatedAt: new Date() }).where(eq(userCredentials.id, row.id));
  return "reset";
}

// --- Login -----------------------------------------------------------------

export type CredentialLookup = {
  id: string;
  email: string;
  organizationId: string;
  fullName: string;
  passwordHash: string;
  verified: boolean;
};

export async function findCredential(email: string): Promise<CredentialLookup | null> {
  const [row] = await getDb().select().from(userCredentials).where(eq(userCredentials.email, email)).limit(1);
  if (!row) return null;
  return { id: row.id, email: row.email, organizationId: row.organizationId, fullName: row.fullName, passwordHash: row.passwordHash, verified: Boolean(row.emailVerifiedAt) };
}

export async function recordLogin(id: string) {
  await getDb().update(userCredentials).set({ lastLoginAt: new Date() }).where(eq(userCredentials.id, id));
}

/** Permissions always come from the organization directory, never from the credential row. */
export async function loadDirectoryUser(email: string, organizationId: string): Promise<{ user: DirectoryUser; source: "sheet" | "database" } | null> {
  if (organizationId === DEFAULT_ORGANIZATION_ID) {
    const sheetUser = await findDirectoryUser(email);
    if (sheetUser) return { user: sheetUser, source: "sheet" };
  }
  const user = await runWithTenantDatabase(organizationId, () => findPostgresDirectoryUser(email, organizationId));
  return user ? { user, source: "database" } : null;
}

// --- Verification email (n8n) ----------------------------------------------

export type AuthEmailResult = { status: "sent" | "failed" | "not_configured"; error?: string };

export function sendPasswordResetEmail(input: { email: string; fullName: string; link: string }): Promise<AuthEmailResult> {
  return postAuthEmail("password_reset_requested", input, {
    subject: "Reset your Smile Recruitment Portal password",
    heading: "Reset your password",
    message: "We received a request to reset your password. Use the link below to choose a new one.",
    note: "This link expires in 1 hour. If you did not request it, you can ignore this email.",
  }, 1);
}

export function sendVerificationEmail(input: { email: string; fullName: string; link: string }): Promise<AuthEmailResult> {
  return postAuthEmail("registration_verification_requested", input, {
    subject: "Verify your Smile Recruitment Portal account",
    heading: "Confirm your email address",
    message: "Thanks for registering. Please confirm your email address to activate your account.",
    note: "This link expires in 24 hours. If you did not register, you can ignore this email.",
  }, VERIFICATION_TTL_MS / 3_600_000);
}

async function postAuthEmail(eventType: string, input: { email: string; fullName: string; link: string }, email: Record<string, string>, expiresInHours: number): Promise<AuthEmailResult> {
  const url = process.env.N8N_VERIFICATION_EMAIL_WEBHOOK_URL?.trim();
  const secret = process.env.N8N_WEBHOOK_SECRET?.trim();
  if (!url || !secret) return { status: "not_configured" };
  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
      body: JSON.stringify({
        eventType,
        recipient: { name: input.fullName, email: input.email },
        verificationLink: input.link,
        actionLink: input.link,
        expiresInHours,
        email,
      }),
      cache: "no-store",
    }, timeoutFromEnv("N8N_VERIFICATION_EMAIL_TIMEOUT_MS", 15_000));
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.ok && result.success !== false) return { status: "sent" };
    return { status: "failed", error: String(result.error || `Email sender returned HTTP ${response.status}.`) };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Unable to send the verification email." };
  }
}
