-- Promo codes: a McLink credit manager creates a code; any organization member
-- can redeem it once for their organization's shared Smile Credits wallet.
--
-- The grant itself is an ordinary credit_account_ledger row (event
-- 'promo_code', +210), written in the same transaction as the redemption row,
-- so the balance, the ledger and the redemption record can never disagree.
--
-- promo_codes.organization_id: NULL = any organization may redeem; set = only
-- that organization. max_redemptions: NULL = no overall limit (each
-- organization is still limited to one redemption per code).

CREATE TABLE IF NOT EXISTS "promo_codes" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"             text NOT NULL UNIQUE CHECK ("code" = upper("code") AND length("code") BETWEEN 4 AND 40),
  "credits"          integer NOT NULL CHECK ("credits" > 0),
  "organization_id"  uuid REFERENCES "organizations" ("id"),
  "max_redemptions"  integer CHECK ("max_redemptions" IS NULL OR "max_redemptions" > 0),
  "redemption_count" integer NOT NULL DEFAULT 0 CHECK ("redemption_count" >= 0),
  "expires_at"       timestamptz,
  "active"           boolean NOT NULL DEFAULT true,
  "note"             text NOT NULL DEFAULT '',
  "created_by_email" text NOT NULL DEFAULT '',
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "disabled_by_email" text NOT NULL DEFAULT '',
  "disabled_at"      timestamptz,
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "promo_code_redemptions" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "promo_code_id"     uuid NOT NULL REFERENCES "promo_codes" ("id"),
  "organization_id"   uuid NOT NULL REFERENCES "organizations" ("id"),
  "credits"           integer NOT NULL CHECK ("credits" > 0),
  "redeemed_by_email" text NOT NULL DEFAULT '',
  "redeemed_by_name"  text NOT NULL DEFAULT '',
  "ledger_source_entry_id" text NOT NULL,
  "redeemed_at"       timestamptz NOT NULL DEFAULT now(),
  -- The hard backstop against a second redemption by the same organization,
  -- even if two requests race past the application checks.
  CONSTRAINT "promo_code_redemptions_code_org_uidx" UNIQUE ("promo_code_id", "organization_id")
);

CREATE INDEX IF NOT EXISTS "promo_code_redemptions_org_idx" ON "promo_code_redemptions" ("organization_id", "redeemed_at");
