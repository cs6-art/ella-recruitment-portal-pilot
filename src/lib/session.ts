import crypto from "node:crypto";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organization-accounts";
import { findPostgresDirectoryUser } from "@/lib/postgres-directory";
import { enterTenantDatabase, runWithTenantDatabase } from "@/lib/tenant-database";

export type SessionUser = {
  sub: string;
  name: string;
  email: string;
  organizationId: string;
  picture?: string;
  active?: boolean;
  exp: number;

  accessRole: string;
  department: string;
  canCreateRole: boolean;
  canReviewRole: boolean;
  canApproveRole: boolean;
  canEditSettings: boolean;
  canManageUsers?: boolean;
  canManageCredits?: boolean;
  // HOD-tier: read-only visibility (plus interview participation) scoped to
  // the user's own department, distinct from canReviewRole's company-wide
  // pipeline management rights. See access-control.ts.
  canReviewDepartmentRole?: boolean;
  // McLink platform administrator (manage organizations, other tenants' users
  // and credit top-ups). Set only at login from the McLink staff directory;
  // self-registered accounts never carry it.
  platformAdmin?: boolean;
};

const COOKIE_NAME = "mclink_session";

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return secret;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function createSessionToken(user: Omit<SessionUser, "exp">, ttlSeconds = 8 * 60 * 60): string {
  const payload: SessionUser = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionToken(token?: string | null): SessionUser | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const user = JSON.parse(decode(payload)) as SessionUser;
    if (!user.exp || user.exp <= Math.floor(Date.now() / 1000)) return null;
    if (user.active === false) return null;
    if (!user.organizationId || typeof user.organizationId !== "string") return null;
    enterTenantDatabase(user.organizationId);
    return user;
  } catch {
    return null;
  }
}

/**
 * Verify the signed cookie and re-check the account's current directory status.
 * A valid, unexpired cookie must stop authorizing requests as soon as HR
 * deactivates the account; the token's original `active` claim is not enough.
 */
export async function getActiveSessionUser(token?: string | null): Promise<SessionUser | null> {
  const user = verifySessionToken(token);
  if (!user) return null;

  try {
    let directoryUser: Awaited<ReturnType<typeof findPostgresDirectoryUser>>;
    if (user.organizationId === DEFAULT_ORGANIZATION_ID) {
      // Load the Google Sheets-backed directory lazily: importing it eagerly
      // would require Sheets configuration even for client-tenant requests.
      const { findDirectoryUser } = await import("@/lib/google-sheets");
      directoryUser = await findDirectoryUser(user.email);
    } else {
      directoryUser = await runWithTenantDatabase(user.organizationId, () => findPostgresDirectoryUser(user.email, user.organizationId));
    }
    if (directoryUser?.active !== true) return null;
    // The cookie's permission claims go stale as soon as HR edits the account,
    // so take the live role and permissions from the directory on every request.
    return {
      ...user,
      accessRole: directoryUser.accessRole,
      department: directoryUser.department,
      canCreateRole: directoryUser.canCreateRole,
      canReviewRole: directoryUser.canReviewRole,
      canApproveRole: directoryUser.canApproveRole,
      canEditSettings: directoryUser.canEditSettings,
      canManageUsers: directoryUser.canManageUsers,
      canManageCredits: directoryUser.canManageCredits,
      canReviewDepartmentRole: directoryUser.canReviewDepartmentRole,
    };
  } catch (error) {
    // Fail closed if the account status cannot be confirmed.
    console.error("[Session] Could not confirm directory status:", error instanceof Error ? error.message : error);
    return null;
  }
}

export { COOKIE_NAME };
