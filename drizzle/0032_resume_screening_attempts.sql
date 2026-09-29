-- A resume hash identifies the document, not a unique screening event. Keep
-- one queue row per submission and resume so HR can intentionally re-screen
-- identical files without replacing the earlier application or result.
ALTER TABLE "bulk_screening_queue_items"
  ADD COLUMN IF NOT EXISTS "submission_id" text NOT NULL DEFAULT '';

ALTER TABLE "bulk_screening_queue_items"
  DROP CONSTRAINT IF EXISTS "bulk_screening_queue_items_role_id_resume_sha256_key";

CREATE UNIQUE INDEX IF NOT EXISTS "bulk_queue_role_submission_sha_uidx"
  ON "bulk_screening_queue_items" ("role_id", "submission_id", "resume_sha256");

CREATE INDEX IF NOT EXISTS "bulk_queue_role_sha_updated_idx"
  ON "bulk_screening_queue_items" ("role_id", "resume_sha256", "updated_at" DESC);
