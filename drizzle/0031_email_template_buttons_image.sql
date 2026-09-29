-- Organizations can also change the wording of an email's buttons and add a header
-- image. An empty value means "use the standard button label" / "no image".

ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "cta_label" text NOT NULL DEFAULT '';
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "secondary_cta_label" text NOT NULL DEFAULT '';
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "image_url" text NOT NULL DEFAULT '';
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "image_alt" text NOT NULL DEFAULT '';
