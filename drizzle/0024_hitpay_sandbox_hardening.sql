-- HitPay payment identity and state hardening.
-- The payment-request id remains in provider_payment_id because it is required
-- for the status API. provider_reference stores HitPay's actual charge id from
-- payments[0].id in the dashboard webhook payload.

CREATE UNIQUE INDEX IF NOT EXISTS "payments_provider_payment_id_uidx"
  ON "payments" ("provider_payment_id")
  WHERE "provider_payment_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "payments_provider_reference_uidx"
  ON "payments" ("provider_reference")
  WHERE "provider_reference" <> '';

ALTER TABLE "payments"
  DROP CONSTRAINT IF EXISTS "payments_status_check";

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_status_check"
  CHECK ("status" IN ('pending', 'paid', 'failed', 'cancelled', 'expired', 'refunded'));
