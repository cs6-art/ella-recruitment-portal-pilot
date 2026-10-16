-- Standalone HR notes on an application (one candidate applying to one role).
--
-- Written by HR from the applicant page without making a decision. HR-only:
-- never returned by any public/candidate endpoint or put in an email.
-- Soft-deleted via deleted_at. Tenant isolation is organization_id only.
--
-- Rollback: DROP TABLE IF EXISTS "application_notes";

CREATE TABLE IF NOT EXISTS "application_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "application_id" uuid NOT NULL REFERENCES "applications"("id"),
  "body" text NOT NULL,
  "author_name" text NOT NULL DEFAULT '',
  "author_email" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "application_notes_application_created_idx" ON "application_notes" ("application_id", "created_at" DESC);
