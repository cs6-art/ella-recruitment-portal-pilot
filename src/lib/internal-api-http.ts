import { NextResponse } from "next/server";

import { authorizeInternalRequest } from "@/lib/internal-api";

/** NextResponse helpers + the route wrapper for the internal recruitment API. */

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "none",
  "Content-Type": "application/json",
} as const;

export function internalJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body as Record<string, unknown>, { status, headers: SECURITY_HEADERS });
}

export function internalUnauthorized(): NextResponse {
  return internalJson({ ok: false, error: "invalid_or_missing_internal_secret" }, 401);
}

export function internalForbiddenEntity(): NextResponse {
  return internalJson({ ok: false, error: "internal_api_entity_not_allowed" }, 403);
}

export function internalConfigurationFailure(error: string): NextResponse {
  return internalJson({ ok: false, error }, 503);
}

/** `{ ok: true, migrated: false }` — the workflow keeps its Sheets fallback. */
/** Reserved for an explicitly authorized, non-security cutover response. */
export function internalNotMigrated(entity: string): NextResponse {
  return internalJson({ ok: true, migrated: false, entity }, 200);
}

/**
 * Wrap an internal route handler: verifies the secret and entity allowlist
 * before route logic, requires the database configuration, and turns thrown
 * errors into a 500 without leaking internals.
 */
export function withInternalAuth(
  entity: string,
  handler: (request: Request) => Promise<NextResponse> | NextResponse,
) {
  return async (request: Request): Promise<NextResponse> => {
    const authorization = authorizeInternalRequest(request, entity);
    if (!authorization.allowed) return internalJson({ ok: false, error: authorization.error }, authorization.status);
    try {
      return await handler(request);
    } catch (error) {
      console.error(`[Internal API ${entity}] handler failed:`, error);
      return internalJson({ ok: false, error: "internal_error" }, 500);
    }
  };
}

/** Read + validate a JSON body against a small guard. */
export async function readInternalJson<T>(request: Request, guard: (value: unknown) => value is T): Promise<T | null> {
  try {
    const body = await request.json();
    return guard(body) ? body : null;
  } catch {
    return null;
  }
}
