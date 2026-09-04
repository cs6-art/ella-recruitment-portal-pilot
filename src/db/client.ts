import { Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";

import * as schema from "@/db/schema";

/**
 * Lazily-created Drizzle client over Neon's serverless pool driver. The pool
 * is required because recruitment operations use real SQL transactions for
 * status/history, HR decisions, and voice-result ingestion. Nothing here runs
 * until a Postgres code path is actually invoked, so `CREDITS_BACKEND=sheets`
 * and `next build` work with `DATABASE_URL` unset.
 */

let cached: NeonDatabase<typeof schema> | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getDb(): NeonDatabase<typeof schema> {
  if (cached) return cached;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not configured. Set it before using a Postgres-backed feature.");
  }
  const pool = new Pool({
    connectionString: url,
    max: 1,
    idleTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });
  cached = drizzle(pool, { schema });
  return cached;
}

export { schema };
