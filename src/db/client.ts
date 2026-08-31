import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "@/db/schema";

/**
 * Lazily-created Drizzle client over the Neon HTTP driver (fetch-based, no
 * connection pool, safe on Vercel serverless). Nothing here runs until a
 * Postgres code path is actually invoked, so `CREDITS_BACKEND=sheets` and
 * `next build` work with `DATABASE_URL` unset.
 */

let cached: NeonHttpDatabase<typeof schema> | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (cached) return cached;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not configured. Set it before using a Postgres-backed feature.");
  }
  cached = drizzle(neon(url), { schema });
  return cached;
}

export { schema };
