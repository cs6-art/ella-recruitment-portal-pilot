import { sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  computeOnboarding,
  newlyCompletedSteps,
  type OnboardingFacts,
  type OnboardingState,
  type OnboardingStepKey,
  type PersistedOnboarding,
} from "@/lib/onboarding";
import { sampleJobById } from "@/lib/sample-catalog";

/**
 * Organization-scoped onboarding persistence.
 *
 * `organizations.onboarding_progress` (migration 0043) is read and written
 * with raw SQL only and is deliberately absent from the Drizzle table
 * definition: if the migration has not been applied yet, every other query on
 * `organizations` keeps working and onboarding is derived from records alone.
 */

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? rows as Row[] : [];
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function str(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asPersisted(value: unknown): PersistedOnboarding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const steps = record.steps && typeof record.steps === "object" && !Array.isArray(record.steps) ? record.steps as Record<string, unknown> : {};
  const sampleRoles = record.sampleRoles && typeof record.sampleRoles === "object" && !Array.isArray(record.sampleRoles) ? record.sampleRoles as Record<string, unknown> : {};
  return {
    steps: Object.fromEntries(Object.entries(steps).filter(([, at]) => typeof at === "string" && at)) as PersistedOnboarding["steps"],
    completedAt: typeof record.completedAt === "string" ? record.completedAt : undefined,
    completionDismissedAt: typeof record.completionDismissedAt === "string" ? record.completionDismissedAt : undefined,
    sampleRoles: Object.fromEntries(Object.entries(sampleRoles).filter(([, id]) => typeof id === "string" && sampleJobById(id))) as Record<string, string>,
  };
}

async function readPersisted(organizationId: string): Promise<{ persisted: PersistedOnboarding; available: boolean }> {
  try {
    const result = await getDb().execute(sql`SELECT onboarding_progress FROM organizations WHERE id = ${organizationId} LIMIT 1`);
    return { persisted: asPersisted(rowsOf(result)[0]?.onboarding_progress), available: true };
  } catch (error) {
    console.warn("[Onboarding] Progress column unavailable; using derived progress only:", error instanceof Error ? error.message : error);
    return { persisted: {}, available: false };
  }
}

/** Merge into the stored JSON. Existing step timestamps always win, so completion is permanent. */
async function mergePersisted(organizationId: string, patch: { steps?: Partial<Record<OnboardingStepKey, string>>; completedAt?: string; completionDismissedAt?: string; sampleRole?: { roleUuid: string; sampleJobId: string } }) {
  const steps = JSON.stringify(patch.steps ?? {});
  const top: Record<string, string> = {};
  if (patch.completionDismissedAt) top.completionDismissedAt = patch.completionDismissedAt;
  const sampleRole = patch.sampleRole ? JSON.stringify({ [patch.sampleRole.roleUuid]: patch.sampleRole.sampleJobId }) : "{}";
  await getDb().execute(sql`
    UPDATE organizations SET onboarding_progress =
      COALESCE(onboarding_progress, '{}'::jsonb)
      || ${JSON.stringify(top)}::jsonb
      || jsonb_build_object('steps', ${steps}::jsonb || COALESCE(onboarding_progress->'steps', '{}'::jsonb))
      || jsonb_build_object('sampleRoles', COALESCE(onboarding_progress->'sampleRoles', '{}'::jsonb) || ${sampleRole}::jsonb)
      || CASE WHEN ${patch.completedAt ?? null}::text IS NOT NULL AND NOT (COALESCE(onboarding_progress, '{}'::jsonb) ? 'completedAt')
              THEN jsonb_build_object('completedAt', ${patch.completedAt ?? null}::text) ELSE '{}'::jsonb END
    WHERE id = ${organizationId}`);
}

/** Counts and latest ids from this organization's own records; no candidate details. */
export async function readOnboardingFacts(organizationId: string): Promise<OnboardingFacts> {
  const db = getDb();
  const [roleRow] = rowsOf(await db.execute(sql`
    SELECT
      count(*)::int AS role_count,
      count(*) FILTER (WHERE lower(status) = 'job_posted' AND (posted_at IS NOT NULL OR posting_confirmed))::int AS published_count
    FROM roles WHERE organization_id = ${organizationId}`));
  const [unpublished] = rowsOf(await db.execute(sql`
    SELECT external_id, lower(status) AS status FROM roles
    WHERE organization_id = ${organizationId}
      AND lower(status) NOT IN ('job_posted', 'rejected', 'closed', 'cancelled')
      AND COALESCE(archive->>'archivedAt', '') = ''
    ORDER BY updated_at DESC LIMIT 1`));
  const [applicationRow] = rowsOf(await db.execute(sql`
    SELECT
      count(*)::int AS application_count,
      count(*) FILTER (WHERE resume_hr_decision <> '')::int AS decided_count,
      (SELECT external_id FROM applications WHERE organization_id = ${organizationId} ORDER BY created_at DESC LIMIT 1) AS latest_application
    FROM applications WHERE organization_id = ${organizationId}`));
  const [screeningRow] = rowsOf(await db.execute(sql`
    SELECT count(*)::int AS screened_count,
      (SELECT a.external_id FROM screening_results s JOIN applications a ON a.id = s.application_id
        WHERE s.organization_id = ${organizationId} AND a.organization_id = ${organizationId}
        ORDER BY s.screened_at DESC NULLS LAST, s.created_at DESC LIMIT 1) AS latest_screened
    FROM screening_results WHERE organization_id = ${organizationId}`));
  const [interviewRow] = rowsOf(await db.execute(sql`
    SELECT
      EXISTS (SELECT 1 FROM booking_tokens WHERE organization_id = ${organizationId} AND kind IN ('voice', 'avatar')) AS invited,
      (EXISTS (SELECT 1 FROM voice_interview_results WHERE organization_id = ${organizationId})
        OR EXISTS (SELECT 1 FROM live_interview_sessions WHERE organization_id = ${organizationId} AND interview_completed_at IS NOT NULL)) AS evidence,
      EXISTS (SELECT 1 FROM oauth_connections WHERE organization_id = ${organizationId} AND provider = 'google_calendar' AND refresh_token_enc <> '') AS calendar`));
  return {
    roleCount: num(roleRow?.role_count),
    publishedRoleCount: num(roleRow?.published_count),
    applicationCount: num(applicationRow?.application_count),
    screenedCount: num(screeningRow?.screened_count),
    decidedCount: num(applicationRow?.decided_count),
    unpublishedRoleId: str(unpublished?.external_id),
    unpublishedRoleStatus: str(unpublished?.status),
    latestApplicationId: str(applicationRow?.latest_application),
    latestScreenedApplicationId: str(screeningRow?.latest_screened),
    interviewInvitationsSent: interviewRow?.invited === true,
    hasInterviewEvidence: interviewRow?.evidence === true,
    calendarConnected: interviewRow?.calendar === true,
  };
}

async function readGuided(organizationId: string) {
  const [row] = rowsOf(await getDb().execute(sql`SELECT onboarding_started_at FROM organizations WHERE id = ${organizationId} LIMIT 1`));
  if (!row) return null;
  return Boolean(row.onboarding_started_at);
}

async function roleExternalIds(organizationId: string, roleUuids: string[]) {
  const valid = roleUuids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (valid.length === 0) return {};
  const rows = rowsOf(await getDb().execute(sql`SELECT id::text AS id, external_id FROM roles WHERE organization_id = ${organizationId} AND id::text IN (${sql.join(valid.map((id) => sql`${id}`), sql`, `)})`));
  return Object.fromEntries(rows.map((row) => [str(row.id), str(row.external_id)]));
}

/**
 * The organization's onboarding state. Newly evidenced steps are recorded so
 * they stay complete; a failed write never fails the read.
 */
export async function getOnboardingState(organizationId: string, user: { canCreateRole?: boolean; canReviewRole?: boolean }): Promise<OnboardingState | null> {
  const guided = await readGuided(organizationId);
  if (guided === null) return null;
  const [facts, { persisted, available }] = await Promise.all([readOnboardingFacts(organizationId), readPersisted(organizationId)]);
  const ids = await roleExternalIds(organizationId, Object.keys(persisted.sampleRoles ?? {}));
  const canAct = user.canCreateRole === true && user.canReviewRole === true;
  const state = computeOnboarding({ guided, facts, persisted, canAct, roleExternalIds: ids });
  const fresh = newlyCompletedSteps(state, persisted);
  if (available && guided && (fresh.length > 0 || (state.status === "completed" && !persisted.completedAt))) {
    const now = new Date().toISOString();
    try {
      await mergePersisted(organizationId, { steps: Object.fromEntries(fresh.map((key) => [key, now])), completedAt: state.status === "completed" ? now : undefined });
    } catch (error) {
      console.warn("[Onboarding] Could not record completed steps:", error instanceof Error ? error.message : error);
    }
  }
  return state;
}

export class OnboardingActionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** HR confirms they reviewed a screened applicant of their own organization. */
export async function acknowledgeApplicantReview(organizationId: string, applicationExternalId: string) {
  const [row] = rowsOf(await getDb().execute(sql`
    SELECT a.id FROM applications a JOIN screening_results s ON s.application_id = a.id
    WHERE a.external_id = ${applicationExternalId} AND a.organization_id = ${organizationId} AND s.organization_id = ${organizationId}
    LIMIT 1`));
  if (!row) throw new OnboardingActionError("This applicant has no screening result to review yet.", 409);
  await mergePersisted(organizationId, { steps: { review_applicant: new Date().toISOString() } });
}

/** Remember which sample JD a role started from, so Resume Screening can suggest the matching sample. */
export async function recordSampleRole(organizationId: string, roleExternalId: string, sampleJobId: string) {
  if (!sampleJobById(sampleJobId)) throw new OnboardingActionError("Unknown sample job description.", 422);
  const [row] = rowsOf(await getDb().execute(sql`SELECT id::text AS id FROM roles WHERE organization_id = ${organizationId} AND external_id = ${roleExternalId} LIMIT 1`));
  if (!row) throw new OnboardingActionError("Role not found.", 404);
  // Keep the map small: a handful of demo roles is all it ever needs.
  const { persisted } = await readPersisted(organizationId);
  if (Object.keys(persisted.sampleRoles ?? {}).length >= 50) return;
  await mergePersisted(organizationId, { sampleRole: { roleUuid: str(row.id), sampleJobId } });
}

export async function dismissOnboardingCompletion(organizationId: string) {
  await mergePersisted(organizationId, { completionDismissedAt: new Date().toISOString() });
}
