-- Enforce the tenant boundary that 0010 introduced on every recruitment
-- entity. Application-level organization filters remain required, but these
-- foreign keys prevent an internal worker or future code path from creating a
-- row for an organization that does not exist.
ALTER TABLE "departments"
  ADD CONSTRAINT "departments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "users"
  ADD CONSTRAINT "users_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "oauth_connections"
  ADD CONSTRAINT "oauth_connections_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "portal_settings"
  ADD CONSTRAINT "portal_settings_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "roles"
  ADD CONSTRAINT "roles_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "role_status_history"
  ADD CONSTRAINT "role_status_history_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "applicants"
  ADD CONSTRAINT "applicants_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "applicant_aliases"
  ADD CONSTRAINT "applicant_aliases_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "resume_files"
  ADD CONSTRAINT "resume_files_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "applications"
  ADD CONSTRAINT "applications_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "screening_results"
  ADD CONSTRAINT "screening_results_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "screening_invitations"
  ADD CONSTRAINT "screening_invitations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "bulk_screening_queue_items"
  ADD CONSTRAINT "bulk_screening_queue_items_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "interview_slots"
  ADD CONSTRAINT "interview_slots_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "voice_call_attempts"
  ADD CONSTRAINT "voice_call_attempts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "voice_interview_results"
  ADD CONSTRAINT "voice_interview_results_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "voice_call_logs"
  ADD CONSTRAINT "voice_call_logs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "booking_tokens"
  ADD CONSTRAINT "booking_tokens_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
ALTER TABLE "application_status_history"
  ADD CONSTRAINT "application_status_history_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id");
