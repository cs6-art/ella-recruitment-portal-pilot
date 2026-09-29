-- An organization's edits to the wording of its automated emails. A missing
-- row means "use the built-in default", so existing organizations are unchanged.

CREATE TABLE IF NOT EXISTS "email_templates" (
  "organization_id" uuid NOT NULL REFERENCES "organizations" ("id"),
  "event_type"      text NOT NULL,
  "subject"         text NOT NULL DEFAULT '',
  "body"            text NOT NULL DEFAULT '',
  "updated_by"      text NOT NULL DEFAULT '',
  "updated_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "email_templates_pkey" PRIMARY KEY ("organization_id", "event_type")
);
