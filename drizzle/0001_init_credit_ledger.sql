-- Phase 2 backend migration — Ella Credit Ledger (first pilot table).
-- Applied manually with `npm run db:migrate`.

CREATE TABLE IF NOT EXISTS "credit_ledger" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entry_time"      timestamptz NOT NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "type"            text NOT NULL,
  "event"           text NOT NULL,
  "units"           integer NOT NULL,
  "credits_delta"   integer NOT NULL,
  "balance_after"   integer NOT NULL,
  "reference"       text NOT NULL DEFAULT '',
  "role_id"         text NOT NULL DEFAULT '',
  "actor_name"      text NOT NULL DEFAULT '',
  "actor_email"     text NOT NULL DEFAULT '',
  "note"            text NOT NULL DEFAULT '',
  "source_entry_id" text UNIQUE
);

CREATE INDEX IF NOT EXISTS "credit_ledger_entry_time_idx" ON "credit_ledger" ("entry_time");

CREATE TABLE IF NOT EXISTS "credit_balance" (
  "id"         integer PRIMARY KEY,
  "balance"    integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- The single balance row. Its value is set authoritatively by the credit
-- backfill; this only guarantees the row exists.
INSERT INTO "credit_balance" ("id", "balance") VALUES (1, 0)
ON CONFLICT ("id") DO NOTHING;
