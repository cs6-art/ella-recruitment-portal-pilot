import crypto from "node:crypto";

type DriveOAuthActor = { email: string; organizationId: string };
type DriveOAuthState = DriveOAuthActor & { purpose: "resume-drive"; exp: number };

/** Bind Google consent to the user and organization that started it. */
export function createDriveOAuthState(email: string, organizationId: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  if (!email.trim() || !organizationId.trim()) throw new Error("A Drive connection requires a user and organization.");
  const payload: DriveOAuthState = {
    email: email.trim().toLowerCase(), organizationId,
    purpose: "resume-drive", exp: Math.floor(Date.now() / 1000) + 600,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyDriveOAuthState(state: string, actor: DriveOAuthActor): DriveOAuthState | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encoded, signature] = parts;
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as DriveOAuthState;
    if (payload.purpose !== "resume-drive" || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (payload.email !== actor.email.trim().toLowerCase() || payload.organizationId !== actor.organizationId) return null;
    return payload;
  } catch {
    return null;
  }
}
