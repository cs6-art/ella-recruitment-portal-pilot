import crypto from "node:crypto";

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
  // HOD-tier: read-only visibility (plus interview participation) scoped to
  // the user's own department, distinct from canReviewRole's company-wide
  // pipeline management rights. See access-control.ts.
  canReviewDepartmentRole?: boolean;
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
    return user;
  } catch {
    return null;
  }
}

export { COOKIE_NAME };
