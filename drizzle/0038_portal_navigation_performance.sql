-- Portal list and dashboard queries filter by tenant, stage/status, and time.
-- These composite indexes match those access paths without changing the
-- permission predicates or exposing cross-organization rows.
CREATE INDEX IF NOT EXISTS "roles_organization_status_idx"
  ON "roles" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "roles_organization_updated_at_idx"
  ON "roles" ("organization_id", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "applications_organization_applied_at_idx"
  ON "applications" ("organization_id", "applied_at" DESC);

CREATE INDEX IF NOT EXISTS "applications_organization_stage_idx"
  ON "applications" ("organization_id", "current_stage");

CREATE INDEX IF NOT EXISTS "interview_slots_organization_status_starts_at_idx"
  ON "interview_slots" ("organization_id", "status", "starts_at");
