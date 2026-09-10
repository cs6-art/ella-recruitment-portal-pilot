-- Persist validated resume context so Pilot workers do not download and parse
-- the same Drive object a second time.
ALTER TABLE "resume_files" ADD COLUMN IF NOT EXISTS "extracted_text" text NOT NULL DEFAULT '';
ALTER TABLE "resume_files" ADD COLUMN IF NOT EXISTS "candidate_name" text NOT NULL DEFAULT '';
ALTER TABLE "resume_files" ADD COLUMN IF NOT EXISTS "candidate_email" text NOT NULL DEFAULT '';
ALTER TABLE "resume_files" ADD COLUMN IF NOT EXISTS "preferred_mobile" text NOT NULL DEFAULT '';
ALTER TABLE "resume_files" ADD COLUMN IF NOT EXISTS "applicant_country" text NOT NULL DEFAULT '';
