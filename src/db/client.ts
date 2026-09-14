import { Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";

import * as schema from "@/db/schema";
import { currentTenantOrganizationId, tenantDatabaseUrl } from "@/lib/tenant-database";

/**
 * Lazily-created Drizzle client over Neon's serverless pool driver. The pool
 * is required because recruitment operations use real SQL transactions for
 * status/history, HR decisions, and voice-result ingestion. Nothing here runs
 * until a Postgres code path is actually invoked, so `CREDITS_BACKEND=sheets`
 * and `next build` work with `DATABASE_URL` unset.
 */

let cached: NeonDatabase<typeof schema> | null = null;
let cachedUrl = "";
const cachedByUrl = new Map<string, NeonDatabase<typeof schema>>();

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getDb(): NeonDatabase<typeof schema> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not configured. Set it before using a Postgres-backed feature.");
  }
  if (cached && cachedUrl === url) return cached;
  const existing = cachedByUrl.get(url);
  if (existing) return existing;
  const pool = new Pool({
    connectionString: url,
    max: 1,
    idleTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });
  const db = drizzle(pool, { schema });
  cached = db;
  cachedUrl = url;
  cachedByUrl.set(url, db);
  return db;
}

/** Return the physical recruitment database for the current signed-in tenant. */
export function getTenantDb(): NeonDatabase<typeof schema> {
  const organizationId = currentTenantOrganizationId();
  const url = tenantDatabaseUrl(organizationId);
  if (!url) {
    throw new Error(`No physical database is configured for organization ${organizationId}. Set TENANT_DATABASE_URLS.`);
  }
  const existing = cachedByUrl.get(url);
  if (existing) return existing;
  const pool = new Pool({ connectionString: url, max: 1, idleTimeoutMillis: 5_000, allowExitOnIdle: true });
  const db = drizzle(pool, { schema });
  cachedByUrl.set(url, db);
  return db;
}

export { schema };
