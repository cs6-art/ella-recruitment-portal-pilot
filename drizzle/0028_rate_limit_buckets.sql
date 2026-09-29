-- Durable rate limiting. The in-memory limiter only counts per serverless
-- instance, so an attacker spread across instances is barely slowed. One row
-- per limiter key holds the current fixed window; the limiter updates it with
-- a single atomic upsert.

CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
  "key"          text PRIMARY KEY,
  "window_start" timestamptz NOT NULL DEFAULT now(),
  "count"        integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "rate_limit_buckets_window_idx" ON "rate_limit_buckets" ("window_start");
