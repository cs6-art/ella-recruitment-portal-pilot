import crypto from "node:crypto";

/**
 * Authenticated internal API used by n8n / Vapi to read and write recruitment
 * state without ever holding database credentials.
 *
 * Auth: a single shared secret in `INTERNAL_API_SECRET`, presented as
 * `Authorization: Bearer <secret>` or `X-Internal-Secret: <secret>`. Compared
 * timing-safe. There is NO cookie / session fallback — a browser cannot reach
 * these endpoints.
 *
 * Rollout: an endpoint serves live data for an entity only when it is listed in
 * `INTERNAL_API_ENTITIES` (comma-separated, or `all`) AND `DATABASE_URL` is
 * set. Authentication and entity authorization are handled before route logic;
 * missing configuration is a server failure, never a successful fallback.
 *
 * This module is framework-free (no `next` import) so it is unit-testable; the
 * NextResponse helpers + route wrapper live in `internal-api-http.ts`.
 */

export function isInternalApiConfigured(): boolean {
  return Boolean(process.env.INTERNAL_API_SECRET?.trim());
}

function presentedSecret(request: Request): string {
  const auth = request.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  return (bearer || request.headers.get("x-internal-secret") || "").trim();
}

export function verifyInternalRequest(request: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET?.trim();
  if (!expected) return false;
  const provided = presentedSecret(request);
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The normalized entity allowlist configured for internal API rollout. */
export function internalApiEntities(): string[] {
  return (process.env.INTERNAL_API_ENTITIES || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function internalEntitiesConfigured(): boolean {
  return internalApiEntities().length > 0;
}

export function internalEntityAllowed(entity: string): boolean {
  return internalApiEntities().includes(entity.trim().toLowerCase());
}

/** Entities whose internal endpoints may serve live Postgres data. */
export function internalEntityEnabled(entity: string): boolean {
  return Boolean(process.env.DATABASE_URL?.trim()) && internalEntityAllowed(entity);
}

export type InternalAuthorizationDecision =
  | { allowed: true }
  | { allowed: false; status: 401 | 403 | 503; error: string };

/**
 * Framework-free authorization decision used by the Next route wrapper and
 * directly testable without importing `next/server`.
 */
export function authorizeInternalRequest(request: Request, entity: string): InternalAuthorizationDecision {
  if (!verifyInternalRequest(request)) {
    return { allowed: false, status: 401, error: "invalid_or_missing_internal_secret" };
  }
  if (!internalEntitiesConfigured()) {
    return { allowed: false, status: 503, error: "internal_api_entities_not_configured" };
  }
  if (!internalEntityAllowed(entity)) {
    return { allowed: false, status: 403, error: "internal_api_entity_not_allowed" };
  }
  if (!process.env.DATABASE_URL?.trim()) {
    return { allowed: false, status: 503, error: "internal_api_database_not_configured" };
  }
  return { allowed: true };
}
