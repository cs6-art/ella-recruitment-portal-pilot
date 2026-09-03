-- Phase 2 backend migration — credit purchases (HitPay).
-- Applied manually with `npm run db:migrate`. Additive only; no change to the
-- credit ledger/balance tables or CREDITS_BACKEND behaviour.

CREATE TABLE IF NOT EXISTS "payments" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "reference"               text NOT NULL UNIQUE,
  "provider"                text NOT NULL DEFAULT 'hitpay',
  "provider_payment_id"     text,
  "provider_reference"      text NOT NULL DEFAULT '',
  "status"                  text NOT NULL DEFAULT 'pending',
  "amount_cents"            integer NOT NULL,
  "currency"                text NOT NULL DEFAULT 'SGD',
  "credits"                 integer NOT NULL,
  "pack_id"                 text NOT NULL DEFAULT '',
  "actor_email"             text NOT NULL DEFAULT '',
  "actor_name"              text NOT NULL DEFAULT '',
  "credit_ledger_source_id" text,
  "credited_at"             timestamptz,
  "paid_at"                 timestamptz,
  "idempotency_key"         text UNIQUE,
  "last_event"              jsonb,
  "created_at"              timestamptz NOT NULL DEFAULT now(),
  "updated_at"              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "payments_status_idx"              ON "payments" ("status");
CREATE INDEX IF NOT EXISTS "payments_provider_payment_id_idx" ON "payments" ("provider_payment_id");
CREATE INDEX IF NOT EXISTS "payments_actor_email_idx"         ON "payments" ("actor_email");
CREATE INDEX IF NOT EXISTS "payments_created_at_idx"          ON "payments" ("created_at");

CREATE TABLE IF NOT EXISTS "payment_events" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "payment_id"      uuid NOT NULL REFERENCES "payments" ("id"),
  "at"              timestamptz NOT NULL DEFAULT now(),
  "source"          text NOT NULL DEFAULT 'webhook',
  "event"           text NOT NULL DEFAULT '',
  "status"          text NOT NULL DEFAULT '',
  "signature_valid" boolean NOT NULL DEFAULT false,
  "dedupe_key"      text UNIQUE,
  "detail"          jsonb
);

CREATE INDEX IF NOT EXISTS "payment_events_payment_id_idx" ON "payment_events" ("payment_id");
