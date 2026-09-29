import crypto from "node:crypto";
import { sql } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db/client";
import { consumeRateLimit, type RateLimitResult } from "@/lib/rate-limit";

/**
 * Rate limit shared by every serverless instance (fixed window in Postgres,
 * one atomic upsert per call). If the database cannot be reached it falls back
 * to the per-instance limiter, so a database problem never blocks real users.
 */
export async function consumeDurableRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  if (!isDatabaseConfigured()) return consumeRateLimit(key, limit, windowMs);
  // Keys can contain emails and IP addresses, so only a hash is stored.
  const storedKey = crypto.createHash("sha256").update(key).digest("hex");
  try {
    const result = await getDb().execute(sql`
      insert into rate_limit_buckets as bucket (key, window_start, count)
      values (${storedKey}, now(), 1)
      on conflict (key) do update set
        window_start = case when bucket.window_start <= now() - make_interval(secs => ${windowMs / 1000}) then now() else bucket.window_start end,
        count = case when bucket.window_start <= now() - make_interval(secs => ${windowMs / 1000}) then 1 else bucket.count + 1 end
      returning count, greatest(1, ceil(extract(epoch from (bucket.window_start + make_interval(secs => ${windowMs / 1000}) - now()))))::int as retry_after
    `);
    const row = (result.rows?.[0] ?? {}) as { count?: number | string; retry_after?: number | string };
    const count = Number(row.count);
    if (!Number.isFinite(count)) return consumeRateLimit(key, limit, windowMs);
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, Number(row.retry_after) || Math.ceil(windowMs / 1000)),
    };
  } catch (error) {
    console.error("[Rate Limit] Durable limiter unavailable; using the per-instance limit:", error);
    return consumeRateLimit(key, limit, windowMs);
  }
}
