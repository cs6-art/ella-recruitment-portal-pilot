-- Credit holds: a booked AI voice interview reserves its full charge (10
-- Smile Credits) on the organization wallet until the call settles.
--
-- A hold never moves credit_accounts.balance and writes no ledger row. It only
-- reduces the *available* balance (balance - active holds), so the ledger stays
-- an exact record of real charges. The hold is resolved when the attempt is
-- billed ('converted'), fails/cancels ('released'), or lapses ('expired').

CREATE TABLE IF NOT EXISTS "credit_holds" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id"  uuid NOT NULL REFERENCES "credit_accounts" ("id"),
  "hold_key"    text NOT NULL,
  "credits"     integer NOT NULL CHECK ("credits" > 0),
  "status"      text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active','converted','released','expired')),
  "reference"   text NOT NULL DEFAULT '',
  "reason"      text NOT NULL DEFAULT '',
  "expires_at"  timestamptz NOT NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz,
  UNIQUE ("account_id", "hold_key")
);
CREATE INDEX IF NOT EXISTS "credit_holds_account_active_idx" ON "credit_holds" ("account_id") WHERE "status" = 'active';
