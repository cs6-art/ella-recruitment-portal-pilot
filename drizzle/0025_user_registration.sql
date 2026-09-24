-- Self-service registration: organizations declare which email domains (or
-- individual addresses) may register into them, and registered users get a
-- credential row that must be email-verified before it can log in.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "allowed_domains" text[] NOT NULL DEFAULT '{}';
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "allowed_emails" text[] NOT NULL DEFAULT '{}';

UPDATE "organizations" SET "allowed_domains" = ARRAY['mclinkgroup.com']
WHERE "id" = '00000000-0000-4000-8000-000000000001';

UPDATE "organizations" SET "allowed_emails" = ARRAY['bong041026@gmail.com', 'lihenb263@gmail.com', 'padillajuliojose@gmail.com']
WHERE "slug" = 'mcprint';

CREATE TABLE IF NOT EXISTS "user_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations" ("id"),
  "full_name" text NOT NULL DEFAULT '',
  "password_hash" text NOT NULL,
  "email_verified_at" timestamptz,
  "verification_token_hash" text,
  "verification_expires_at" timestamptz,
  "reset_token_hash" text,
  "reset_expires_at" timestamptz,
  "last_login_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_credentials_email_uidx" ON "user_credentials" ("email");
CREATE INDEX IF NOT EXISTS "user_credentials_token_idx" ON "user_credentials" ("verification_token_hash");
