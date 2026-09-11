-- Avatar interview invitations use the same booking-token table as voice and
-- final invitations. Keep this forward-only so existing Pilot databases adopt
-- the new token kind without rewriting historical migrations.
ALTER TABLE "booking_tokens" DROP CONSTRAINT IF EXISTS "booking_tokens_kind_check";
ALTER TABLE "booking_tokens"
  ADD CONSTRAINT "booking_tokens_kind_check"
  CHECK ("kind" IN ('voice', 'final', 'avatar'));
