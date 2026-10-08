-- Event launch promotion ("first N organizations get X welcome credits") and
-- structured user feedback.
--
-- Launch promotion
-- ----------------
-- One row per promotion. A new organization claims a slot with a single
-- conditional UPDATE inside its creation transaction:
--
--   UPDATE launch_promotions SET allocated_count = allocated_count + 1
--   WHERE key = ... AND active AND starts_at <= now() AND allocated_count < max_allocations
--
-- Concurrent claims queue on that row's lock and each re-checks the WHERE
-- clause once it holds the lock, so no more than max_allocations organizations
-- can ever succeed. The CHECK constraint below is a second, database-level
-- backstop. The counter, the allocation row and the credit-ledger entry are
-- written in the same transaction, so they cannot disagree, and a failed
-- organization creation gives the slot back automatically.
--
-- The promotion is seeded INACTIVE. A McLink platform administrator switches
-- it on from the Launch Monitor page; that stamps starts_at, so only
-- organizations created afterwards can ever receive it. Nothing here touches
-- an existing organization or any existing balance.

CREATE TABLE IF NOT EXISTS "launch_promotions" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key"             text NOT NULL UNIQUE,
  "name"            text NOT NULL,
  "credits"         integer NOT NULL CHECK ("credits" > 0),
  "max_allocations" integer NOT NULL CHECK ("max_allocations" > 0),
  "allocated_count" integer NOT NULL DEFAULT 0,
  "active"          boolean NOT NULL DEFAULT false,
  "starts_at"       timestamptz,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "launch_promotions_allocated_within_cap" CHECK ("allocated_count" >= 0 AND "allocated_count" <= "max_allocations")
);

CREATE TABLE IF NOT EXISTS "launch_promotion_allocations" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "promotion_id"           uuid NOT NULL REFERENCES "launch_promotions" ("id"),
  "organization_id"        uuid NOT NULL REFERENCES "organizations" ("id"),
  "sequence_number"        integer NOT NULL,
  "credits"                integer NOT NULL CHECK ("credits" > 0),
  "ledger_source_entry_id" text NOT NULL,
  "allocated_at"           timestamptz NOT NULL DEFAULT now(),
  -- An organization can receive a given promotion at most once.
  CONSTRAINT "launch_promotion_allocations_org_uidx" UNIQUE ("promotion_id", "organization_id"),
  CONSTRAINT "launch_promotion_allocations_sequence_uidx" UNIQUE ("promotion_id", "sequence_number")
);

INSERT INTO "launch_promotions" ("key", "name", "credits", "max_allocations", "active")
VALUES ('event-launch-first-100', 'Event Launch — First 100 Organizations', 250, 100, false)
ON CONFLICT ("key") DO NOTHING;

-- User feedback (sign-out prompt and Smile Bot share one form).
CREATE TABLE IF NOT EXISTS "portal_feedback" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"        uuid NOT NULL REFERENCES "organizations" ("id"),
  "user_email"             text NOT NULL DEFAULT '',
  "user_name"              text NOT NULL DEFAULT '',
  "source"                 text NOT NULL CHECK ("source" IN ('sign_out', 'smile_bot')),
  "navigation_ease"        smallint NOT NULL CHECK ("navigation_ease" BETWEEN 1 AND 5),
  "task_completion"        smallint NOT NULL CHECK ("task_completion" BETWEEN 1 AND 5),
  "ai_usefulness"          smallint NOT NULL CHECK ("ai_usefulness" BETWEEN 1 AND 5),
  "experienced_issue"      boolean NOT NULL,
  "issue_description"      text NOT NULL DEFAULT '',
  "improvement_suggestion" text NOT NULL DEFAULT '',
  "created_at"             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "portal_feedback_created_idx" ON "portal_feedback" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "portal_feedback_org_idx" ON "portal_feedback" ("organization_id", "created_at" DESC);
