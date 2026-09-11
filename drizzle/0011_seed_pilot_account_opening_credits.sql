-- Record the two Pilot starting balances in the per-user audit ledger.
-- The account balance itself was seeded by 0010; this is an idempotent
-- opening entry so ledger totals reconcile without changing either balance.
INSERT INTO "credit_account_ledger"
  ("account_id", "type", "event", "units", "credits_delta", "balance_after",
   "actor_email", "note", "source_entry_id")
SELECT
  "id", 'TopUp', 'manual_adjustment', 300, 300, 300,
  "owner_email", 'Pilot per-user opening credit balance',
  'pilot-opening-credits:' || "owner_email"
FROM "credit_accounts"
WHERE "organization_id" = '00000000-0000-4000-8000-000000000001'
  AND "owner_email" IN ('cs6@mclinkgroup.com', 'cs9@mclinkgroup.com')
ON CONFLICT ("account_id", "source_entry_id") DO NOTHING;
