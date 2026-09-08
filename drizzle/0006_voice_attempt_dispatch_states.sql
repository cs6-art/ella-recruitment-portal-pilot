-- The voice dispatch worker uses an explicit pre-provider lock state. The
-- original recruitment migration predated that state and also omitted the
-- terminal system-failure state used by the internal API.
ALTER TABLE "voice_call_attempts"
  DROP CONSTRAINT IF EXISTS "voice_call_attempts_status_check";
ALTER TABLE "voice_call_attempts"
  ADD CONSTRAINT "voice_call_attempts_status_check"
  CHECK ("status" IN (
    'scheduled','queued','calling','dispatching','initiated','in_progress',
    'completed','retry_scheduled','no_show','cancelled','failed'
  ));

ALTER TABLE "voice_call_attempts"
  DROP CONSTRAINT IF EXISTS "voice_call_attempts_outcome_check";
ALTER TABLE "voice_call_attempts"
  ADD CONSTRAINT "voice_call_attempts_outcome_check"
  CHECK ("outcome" IS NULL OR "outcome" IN (
    'completed','no_answer','busy','wrong_person','no_show','cancelled',
    'system_failure'
  ));
