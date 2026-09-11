-- Multi-organization foundation for the Pilot.
-- Existing recruitment rows remain in the McLink Group organization. The
-- application enables tenant filtering only after this migration is applied.
CREATE TABLE IF NOT EXISTS "organizations" (
  "id" uuid PRIMARY KEY,
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "organizations" ("id", "slug", "name") VALUES
  ('00000000-0000-4000-8000-000000000001', 'mclinkgroup', 'McLink Group')
ON CONFLICT ("slug") DO NOTHING;

CREATE TABLE IF NOT EXISTS "organization_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations" ("id"),
  "email" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("organization_id", "email")
);
CREATE INDEX IF NOT EXISTS "organization_memberships_email_idx" ON "organization_memberships" ("email", "active");

INSERT INTO "organization_memberships" ("organization_id", "email") VALUES
  ('00000000-0000-4000-8000-000000000001', 'cs6@mclinkgroup.com'),
  ('00000000-0000-4000-8000-000000000001', 'cs9@mclinkgroup.com')
ON CONFLICT ("organization_id", "email") DO NOTHING;

-- Add tenant ownership to every recruitment entity. Child rows inherit their
-- tenant from their role, applicant, or application before becoming NOT NULL.
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "oauth_connections" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "portal_settings" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "role_status_history" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "applicants" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "applicant_aliases" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "resume_files" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "credit_owner_email" text NOT NULL DEFAULT '';
ALTER TABLE "screening_results" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "screening_invitations" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "bulk_screening_queue_items" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "interview_slots" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "voice_call_attempts" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "voice_interview_results" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "voice_call_logs" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "booking_tokens" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
ALTER TABLE "application_status_history" ADD COLUMN IF NOT EXISTS "organization_id" uuid;

UPDATE "departments" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;
UPDATE "users" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;
UPDATE "oauth_connections" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;
UPDATE "portal_settings" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;
UPDATE "roles" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;
UPDATE "applicants" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;
UPDATE "resume_files" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;
UPDATE "applications" a SET "organization_id" = r."organization_id" FROM "roles" r WHERE a."role_id" = r."id" AND a."organization_id" IS NULL;
UPDATE "applications" a SET "credit_owner_email" = lower(trim(r."requester_email")) FROM "roles" r WHERE a."role_id" = r."id" AND a."credit_owner_email" = '' AND trim(r."requester_email") <> '';
UPDATE "role_status_history" h SET "organization_id" = r."organization_id" FROM "roles" r WHERE h."role_id" = r."id" AND h."organization_id" IS NULL;
UPDATE "applicant_aliases" x SET "organization_id" = a."organization_id" FROM "applicants" a WHERE x."applicant_id" = a."id" AND x."organization_id" IS NULL;
UPDATE "screening_results" x SET "organization_id" = a."organization_id" FROM "applications" a WHERE x."application_id" = a."id" AND x."organization_id" IS NULL;
UPDATE "screening_invitations" x SET "organization_id" = r."organization_id" FROM "roles" r WHERE x."role_id" = r."id" AND x."organization_id" IS NULL;
UPDATE "bulk_screening_queue_items" x SET "organization_id" = r."organization_id" FROM "roles" r WHERE x."role_id" = r."id" AND x."organization_id" IS NULL;
UPDATE "interview_slots" x SET "organization_id" = r."organization_id" FROM "roles" r WHERE r."id" = x."role_id" AND x."organization_id" IS NULL;
UPDATE "interview_slots" x SET "organization_id" = a."organization_id" FROM "applications" a WHERE a."id" = x."application_id" AND x."organization_id" IS NULL;
UPDATE "interview_slots" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;
UPDATE "voice_call_attempts" x SET "organization_id" = a."organization_id" FROM "applications" a WHERE x."application_id" = a."id" AND x."organization_id" IS NULL;
UPDATE "voice_interview_results" x SET "organization_id" = a."organization_id" FROM "applications" a WHERE x."application_id" = a."id" AND x."organization_id" IS NULL;
UPDATE "voice_call_logs" x SET "organization_id" = a."organization_id" FROM "applications" a WHERE x."application_id" = a."id" AND x."organization_id" IS NULL;
UPDATE "booking_tokens" x SET "organization_id" = a."organization_id" FROM "applications" a WHERE x."application_id" = a."id" AND x."organization_id" IS NULL;
UPDATE "application_status_history" x SET "organization_id" = a."organization_id" FROM "applications" a WHERE x."application_id" = a."id" AND x."organization_id" IS NULL;

ALTER TABLE "departments" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "oauth_connections" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "portal_settings" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "roles" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "role_status_history" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "applicants" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "applicant_aliases" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "resume_files" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "applications" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "screening_results" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "screening_invitations" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "bulk_screening_queue_items" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "interview_slots" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "voice_call_attempts" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "voice_interview_results" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "voice_call_logs" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "booking_tokens" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "application_status_history" ALTER COLUMN "organization_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "roles_organization_id_idx" ON "roles" ("organization_id");
CREATE INDEX IF NOT EXISTS "applicants_organization_id_idx" ON "applicants" ("organization_id");
CREATE INDEX IF NOT EXISTS "applications_organization_id_idx" ON "applications" ("organization_id");

CREATE TABLE IF NOT EXISTS "credit_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations" ("id"),
  "owner_email" text NOT NULL,
  "balance" integer NOT NULL DEFAULT 0 CHECK ("balance" >= 0),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("organization_id", "owner_email")
);
CREATE INDEX IF NOT EXISTS "credit_accounts_owner_email_idx" ON "credit_accounts" ("owner_email", "organization_id");

CREATE TABLE IF NOT EXISTS "credit_account_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id" uuid NOT NULL REFERENCES "credit_accounts" ("id"),
  "entry_time" timestamptz NOT NULL DEFAULT now(),
  "type" text NOT NULL,
  "event" text NOT NULL,
  "units" integer NOT NULL,
  "credits_delta" integer NOT NULL,
  "balance_after" integer NOT NULL,
  "reference" text NOT NULL DEFAULT '',
  "role_id" text NOT NULL DEFAULT '',
  "actor_name" text NOT NULL DEFAULT '',
  "actor_email" text NOT NULL DEFAULT '',
  "note" text NOT NULL DEFAULT '',
  "source_entry_id" text NOT NULL,
  UNIQUE ("account_id", "source_entry_id")
);
CREATE INDEX IF NOT EXISTS "credit_account_ledger_account_time_idx" ON "credit_account_ledger" ("account_id", "entry_time" DESC);

INSERT INTO "credit_accounts" ("organization_id", "owner_email", "balance") VALUES
  ('00000000-0000-4000-8000-000000000001', 'cs6@mclinkgroup.com', 300),
  ('00000000-0000-4000-8000-000000000001', 'cs9@mclinkgroup.com', 300)
ON CONFLICT ("organization_id", "owner_email") DO NOTHING;
