-- Self-service organizations: a registration from a company email domain that
-- no organization owns creates a new organization once the email is verified.
-- Until then the credential has no organization, so organization_id must allow NULL.
ALTER TABLE "user_credentials"
  ALTER COLUMN "organization_id" DROP NOT NULL;
