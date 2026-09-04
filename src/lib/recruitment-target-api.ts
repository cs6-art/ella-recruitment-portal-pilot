/**
 * Server-only portal adapter for the inactive Postgres target surface.
 * Current portal routes intentionally do not import this module: routing stays
 * on Sheets until a separately reviewed cutover. Keeping the adapter here
 * ensures any future portal caller uses the same authenticated internal API as
 * n8n and never receives database credentials.
 */

type TargetRequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

function targetOrigin(): string {
  const origin = process.env.INTERNAL_API_ORIGIN?.trim() || process.env.APP_URL?.trim() || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.trim()}` : "");
  if (!origin) throw new Error("INTERNAL_API_ORIGIN is not configured");
  return origin.replace(/\/$/, "");
}

/** Call an inactive target route from trusted server code only. */
export async function targetRecruitmentRequest<T>(path: string, options: TargetRequestOptions = {}): Promise<T> {
  const secret = process.env.INTERNAL_API_SECRET?.trim();
  if (!secret) throw new Error("INTERNAL_API_SECRET is not configured");
  const response = await fetch(`${targetOrigin()}${path.startsWith("/") ? path : `/${path}`}`, {
    ...options,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${secret}`, ...(options.headers || {}) },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as T | { error?: string } | null;
  if (!response.ok) throw new Error(`Target recruitment API ${response.status}: ${payload && typeof payload === "object" && "error" in payload ? payload.error : "request_failed"}`);
  return payload as T;
}
