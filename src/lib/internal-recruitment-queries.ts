import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { appendPostgresLedgerEntryOnExecutor } from "@/lib/ella-credits-postgres";
import type { LedgerAppend } from "@/lib/ella-credits-store";
import {
  applicants,
  applications,
  applicationStatusHistory,
  bookingTokens,
  bulkScreeningQueueItems,
  interviewSlots,
  roleStatusHistory,
  roles,
  resumeFiles,
  screeningInvitations,
  screeningResults,
  voiceCallAttempts,
  voiceCallLogs,
  voiceInterviewResults,
} from "@/db/schema-recruitment";

/** Postgres-only target helpers. New entities stay inactive until explicitly enabled. */
const LIMIT = 100;
const PILOT_EMAIL_RECIPIENT = "cs6@mclinkgroup.com";
const STAGES = ["resume_review", "resume_approved", "voice_booking_pending", "voice_scheduled", "voice_review_pending", "approved_for_final", "final_scheduled", "final_decision_pending", "passed_final", "rejected", "withdrawn"] as const;
const DECISIONS = ["", "approve", "reject", "manual_review", "pending"] as const;
const STAGE_TRANSITIONS: Record<string, readonly string[]> = {
  resume_review: ["resume_approved", "rejected", "withdrawn"],
  resume_approved: ["voice_booking_pending", "rejected", "withdrawn"],
  voice_booking_pending: ["voice_scheduled", "rejected", "withdrawn"],
  voice_scheduled: ["voice_review_pending", "withdrawn"],
  voice_review_pending: ["approved_for_final", "rejected", "withdrawn"],
  approved_for_final: ["final_scheduled", "rejected", "withdrawn"],
  final_scheduled: ["final_decision_pending", "withdrawn"],
  final_decision_pending: ["passed_final", "rejected", "withdrawn"],
  passed_final: [],
  rejected: [],
  withdrawn: [],
};
const VOICE_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  scheduled: ["queued", "calling", "cancelled"], queued: ["calling", "cancelled"], retry_scheduled: ["queued", "calling", "cancelled"],
  calling: ["initiated", "in_progress", "completed", "no_show", "cancelled"], initiated: ["in_progress", "completed", "no_show", "cancelled"],
  in_progress: ["completed", "no_show", "cancelled"], completed: [], no_show: [], cancelled: [],
};

function isoOrNull(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("invalid_timestamp");
  return date;
}

function rowsOf<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { rows?: unknown }).rows)) {
    return (value as { rows: T[] }).rows;
  }
  return [];
}
export function isValidStage(value: string): value is (typeof STAGES)[number] { return (STAGES as readonly string[]).includes(value); }
export function isValidDecision(value: string): value is (typeof DECISIONS)[number] { return (DECISIONS as readonly string[]).includes(value); }
export function isValidTransition(from: string, to: string): boolean { return STAGE_TRANSITIONS[from]?.includes(to) ?? false; }

export async function listRoles(status?: string) {
  const db = getDb();
  return db.select().from(roles).where(status ? eq(roles.status, status) : undefined).orderBy(desc(roles.updatedAt)).limit(LIMIT);
}

export async function getRole(externalId: string) {
  const db = getDb();
  const [role] = await db.select().from(roles).where(eq(roles.externalId, externalId.trim())).limit(1);
  return role ?? null;
}

export async function createRole(input: { externalId: string; title: string; code?: string; departmentSnapshot?: string; requestType?: string; vacancies?: number; reason?: string; targetHiringDate?: string; status?: string; source?: string; requesterEmail?: string; requesterName?: string; actionRequestId?: string; actorEmail?: string; actorName?: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [role] = await tx.insert(roles).values({ externalId: input.externalId.trim(), title: input.title.trim(), code: input.code?.trim() || null, departmentSnapshot: input.departmentSnapshot || "", requestType: input.requestType || "", vacancies: input.vacancies ?? 1, reason: input.reason || "", targetHiringDate: input.targetHiringDate || null, status: input.status || "draft", source: input.source || "internal_api", requesterEmail: input.requesterEmail || "", requesterName: input.requesterName || "", updatedByEmail: input.actorEmail || "" }).onConflictDoNothing({ target: roles.externalId }).returning();
    if (!role) {
      const [existing] = await tx.select().from(roles).where(eq(roles.externalId, input.externalId.trim())).limit(1);
      return { role: existing ?? null, created: false };
    }
    await tx.insert(roleStatusHistory).values({ roleId: role.id, previousStatus: "", newStatus: role.status, action: "role_created", actionSource: "internal_api", actionRequestId: input.actionRequestId || null, changedByEmail: input.actorEmail || "", changedByName: input.actorName || "" }).onConflictDoNothing({ target: roleStatusHistory.actionRequestId });
    return { role, created: true };
  });
}

export async function updateRoleStatus(input: { externalId: string; newStatus: string; actorEmail?: string; actorName?: string; comments?: string; actionRequestId: string }) {
  const db = getDb();
  const allowed = ["draft", "pending_hr_discussion", "approved", "recruitment_setup", "job_posted", "returned_for_revision", "on_hold", "rejected"];
  if (!allowed.includes(input.newStatus)) return { updated: false, error: "invalid_status" as const };
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(roles).where(eq(roles.externalId, input.externalId)).for("update").limit(1);
    if (!current) return { updated: false, error: "unknown_role" as const };
    const [existing] = await tx.select({ id: roleStatusHistory.id }).from(roleStatusHistory).where(eq(roleStatusHistory.actionRequestId, input.actionRequestId)).limit(1);
    if (existing) return { updated: false, duplicate: true, error: null };
    if (current.status === input.newStatus) return { updated: false, duplicate: false, error: "invalid_transition" as const };
    await tx.update(roles).set({ status: input.newStatus, latestComments: input.comments || "", updatedByEmail: input.actorEmail || "", updatedAt: new Date() }).where(eq(roles.id, current.id));
    await tx.insert(roleStatusHistory).values({ roleId: current.id, previousStatus: current.status, newStatus: input.newStatus, comments: input.comments || "", action: "status_update", actionSource: "internal_api", actionRequestId: input.actionRequestId, changedByEmail: input.actorEmail || "", changedByName: input.actorName || "" });
    return { updated: true, duplicate: false, error: null };
  });
}

export async function updateRoleDetails(input: {
  externalId: string;
  status?: string;
  title?: string;
  code?: string | null;
  departmentSnapshot?: string;
  requestType?: string;
  vacancies?: number;
  reason?: string;
  targetHiringDate?: string | null;
  recruitmentSetupStatus?: string;
  setup?: unknown;
  evaluationFields?: unknown;
  availabilityRules?: unknown;
  hrCalendarEmail?: string;
  applicationLink?: string;
  postedAt?: string | null;
  postedBy?: string;
  postingConfirmed?: boolean;
  approvedBy?: string;
  approvedAt?: string | null;
  latestComments?: string;
  actionRequestId?: string;
  actorName?: string;
  action?: string;
  actorEmail: string;
}) {
  const db = getDb();
  const patch = {
    ...(input.title === undefined ? {} : { title: input.title.trim() }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.code === undefined ? {} : { code: input.code?.trim() || null }),
    ...(input.departmentSnapshot === undefined ? {} : { departmentSnapshot: input.departmentSnapshot }),
    ...(input.requestType === undefined ? {} : { requestType: input.requestType }),
    ...(input.vacancies === undefined ? {} : { vacancies: Math.max(1, Math.trunc(input.vacancies)) }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.targetHiringDate === undefined ? {} : { targetHiringDate: input.targetHiringDate }),
    ...(input.recruitmentSetupStatus === undefined ? {} : { recruitmentSetupStatus: input.recruitmentSetupStatus }),
    ...(input.setup === undefined ? {} : { setup: input.setup as object }),
    ...(input.evaluationFields === undefined ? {} : { evaluationFields: input.evaluationFields as object }),
    ...(input.availabilityRules === undefined ? {} : { availabilityRules: input.availabilityRules as object }),
    ...(input.hrCalendarEmail === undefined ? {} : { hrCalendarEmail: input.hrCalendarEmail }),
    ...(input.applicationLink === undefined ? {} : { applicationLink: input.applicationLink }),
    ...(input.postedAt === undefined ? {} : { postedAt: isoOrNull(input.postedAt) }),
    ...(input.postedBy === undefined ? {} : { postedBy: input.postedBy }),
    ...(input.postingConfirmed === undefined ? {} : { postingConfirmed: input.postingConfirmed }),
    ...(input.approvedBy === undefined ? {} : { approvedBy: input.approvedBy }),
    ...(input.approvedAt === undefined ? {} : { approvedAt: isoOrNull(input.approvedAt) }),
    ...(input.latestComments === undefined ? {} : { latestComments: input.latestComments }),
    updatedByEmail: input.actorEmail,
    updatedAt: new Date(),
  };
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ id: roles.id, status: roles.status }).from(roles).where(eq(roles.externalId, input.externalId.trim())).limit(1);
    if (!current) return null;
    const [role] = await tx.update(roles).set(patch).where(eq(roles.id, current.id)).returning();
    if (role && input.status && current.status !== input.status && input.actionRequestId) {
      await tx.insert(roleStatusHistory).values({
        roleId: current.id,
        previousStatus: current.status,
        newStatus: input.status,
        comments: input.latestComments || "",
        action: input.action || "role_updated",
        actionSource: "portal_postgres_target",
        actionRequestId: input.actionRequestId,
        changedByEmail: input.actorEmail,
        changedByName: input.actorName || "",
      }).onConflictDoNothing({ target: roleStatusHistory.actionRequestId });
    }
    return role ?? null;
  });
}

/** Target-mode role deletion is a reversible archive, never a hard delete. */
export async function archiveRole(input: { externalId: string; actorEmail: string; actorName?: string; actionRequestId: string }) {
  return updateRoleDetails({
    externalId: input.externalId,
    status: "archived",
    latestComments: "Role archived by portal operator",
    actionRequestId: input.actionRequestId,
    actorEmail: input.actorEmail,
    actorName: input.actorName,
    action: "role_archived",
  });
}

export async function listApplicants(email?: string) {
  const db = getDb();
  return db.select().from(applicants).where(email ? eq(applicants.primaryEmail, email.trim().toLowerCase()) : undefined).orderBy(desc(applicants.updatedAt)).limit(LIMIT);
}

export async function upsertApplicant(input: { email: string; fullName?: string; phoneE164?: string; country?: string; notes?: string }) {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  const [applicant] = await db.insert(applicants).values({ primaryEmail: email, fullName: input.fullName || "", phoneE164: input.phoneE164 || "", country: input.country || "", notes: input.notes || "" }).onConflictDoUpdate({ target: applicants.primaryEmail, set: { fullName: input.fullName || "", phoneE164: input.phoneE164 || "", country: input.country || "", notes: input.notes || "", updatedAt: new Date() } }).returning();
  return applicant;
}

export async function listApplications(stage?: string, roleExternalId?: string) {
  const db = getDb();
  const stageWhere = stage ? eq(applications.currentStage, stage) : undefined;
  const query = db.select({ application: applications, roleExternalId: roles.externalId, roleTitle: roles.title, departmentSnapshot: roles.departmentSnapshot, applicantEmail: applicants.primaryEmail })
    .from(applications)
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .innerJoin(applicants, eq(applicants.id, applications.applicantId));
  return (roleExternalId ? query.where(and(stageWhere, eq(roles.externalId, roleExternalId))) : query.where(stageWhere))
    .orderBy(desc(applications.updatedAt)).limit(LIMIT);
}

export async function listRoleStatusHistory(externalId: string) {
  const db = getDb();
  return db.select({ history: roleStatusHistory, roleExternalId: roles.externalId })
    .from(roleStatusHistory)
    .innerJoin(roles, eq(roles.id, roleStatusHistory.roleId))
    .where(eq(roles.externalId, externalId.trim()))
    .orderBy(desc(roleStatusHistory.changedAt))
    .limit(LIMIT);
}

export async function createApplication(input: { externalId: string; applicantEmail: string; applicantName?: string; phone?: string; preferredMobile?: string; applicantCountry?: string; roleExternalId: string; source?: string; sourceDetail?: string; consentAt?: string; resumeFileId?: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [role] = await tx.select({ id: roles.id, departmentSnapshot: roles.departmentSnapshot }).from(roles).where(eq(roles.externalId, input.roleExternalId)).limit(1);
    if (!role) return { application: null, created: false, error: "unknown_role" as const };
    const email = input.applicantEmail.trim().toLowerCase();
    const [applicant] = await tx.insert(applicants).values({ primaryEmail: email, fullName: input.applicantName || "", phoneE164: input.phone || "", country: input.applicantCountry || "" }).onConflictDoUpdate({ target: applicants.primaryEmail, set: { fullName: input.applicantName || "", phoneE164: input.phone || "", country: input.applicantCountry || "", updatedAt: new Date() } }).returning();
    const [application] = await tx.insert(applications).values({ externalId: input.externalId.trim(), applicantId: applicant.id, roleId: role.id, source: input.source || "direct", sourceDetail: input.sourceDetail || "", consentAt: isoOrNull(input.consentAt), departmentSnapshot: role.departmentSnapshot, candidateName: input.applicantName || applicant.fullName, email, phone: input.phone || "", preferredMobile: input.preferredMobile || "", applicantCountry: input.applicantCountry || "", resumeFileId: input.resumeFileId || null }).onConflictDoNothing({ target: applications.externalId }).returning();
    if (!application) {
      const [existing] = await tx.select().from(applications).where(eq(applications.externalId, input.externalId.trim())).limit(1);
      return { application: existing ?? null, created: false, error: null };
    }
    await tx.insert(applicationStatusHistory).values({
      applicationId: application.id,
      stage: "application_received",
      previousStage: "",
      newStage: application.currentStage,
      source: "target:application",
      actionRequestId: `email:application_acknowledgment:${application.externalId}`,
      notificationStatus: "pending",
      notificationEventType: "application_acknowledgment",
      notificationRecipient: PILOT_EMAIL_RECIPIENT,
      notificationIntendedRecipient: email,
    }).onConflictDoNothing({ target: applicationStatusHistory.actionRequestId });
    return { application, created: true, error: null };
  });
}

export async function registerResumeFile(input: { storageRef: string; sha256: string; filename: string; mimeType: string; size: number; kind: string; expiresAt?: string }) {
  const db = getDb();
  const [row] = await db.insert(resumeFiles).values({ storageRef: input.storageRef, sha256: input.sha256, filename: input.filename, mimeType: input.mimeType, size: input.size, kind: input.kind, textExtracted: false, expiresAt: isoOrNull(input.expiresAt) }).onConflictDoNothing({ target: resumeFiles.storageRef }).returning({ id: resumeFiles.id });
  if (row) return row.id;
  const [existing] = await db.select({ id: resumeFiles.id }).from(resumeFiles).where(eq(resumeFiles.storageRef, input.storageRef)).limit(1);
  return existing?.id || null;
}

export async function getApplication(externalId: string) {
  const db = getDb();
  const [row] = await db.select({ application: applications, roleExternalId: roles.externalId, roleTitle: roles.title, departmentSnapshot: roles.departmentSnapshot, applicantEmail: applicants.primaryEmail }).from(applications).innerJoin(roles, eq(roles.id, applications.roleId)).innerJoin(applicants, eq(applicants.id, applications.applicantId)).where(eq(applications.externalId, externalId)).limit(1);
  return row ?? null;
}

export async function updateApplicationProfile(input: {
  externalId: string;
  candidateName?: string;
  phone?: string;
  preferredMobile?: string;
  applicantCountry?: string;
  sourceDetail?: string;
  actorEmail?: string;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(applications).where(eq(applications.externalId, input.externalId.trim())).for("update").limit(1);
    if (!current) return { application: null, error: "unknown_application" as const };
    const applicationPatch = {
      ...(input.candidateName === undefined ? {} : { candidateName: input.candidateName }),
      ...(input.phone === undefined ? {} : { phone: input.phone }),
      ...(input.preferredMobile === undefined ? {} : { preferredMobile: input.preferredMobile }),
      ...(input.applicantCountry === undefined ? {} : { applicantCountry: input.applicantCountry }),
      ...(input.sourceDetail === undefined ? {} : { sourceDetail: input.sourceDetail }),
      updatedAt: new Date(),
    };
    const [application] = await tx.update(applications).set(applicationPatch).where(eq(applications.id, current.id)).returning();
    if (input.candidateName !== undefined || input.phone !== undefined || input.applicantCountry !== undefined) {
      await tx.update(applicants).set({
        ...(input.candidateName === undefined ? {} : { fullName: input.candidateName }),
        ...(input.phone === undefined ? {} : { phoneE164: input.phone }),
        ...(input.applicantCountry === undefined ? {} : { country: input.applicantCountry }),
        updatedAt: new Date(),
      }).where(eq(applicants.id, current.applicantId));
    }
    return { application, error: null };
  });
}

export async function upsertScreeningResult(input: { applicationExternalId: string; matchScore?: number | null; recommendation?: string; summary?: string; strengths?: string; gaps?: string; interviewQuestions?: string; evaluationScores?: unknown; screenedAt?: string; raw?: unknown }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [application] = await tx.select({ id: applications.id, email: applications.email }).from(applications).where(eq(applications.externalId, input.applicationExternalId)).limit(1);
    if (!application) return { result: null, error: "unknown_application" as const };
    const resultValues = { matchScore: input.matchScore ?? null, recommendation: input.recommendation || "", summary: input.summary || "", strengths: input.strengths || "", gaps: input.gaps || "", interviewQuestions: input.interviewQuestions || "", evaluationScores: (input.evaluationScores ?? []) as object, screenedAt: isoOrNull(input.screenedAt), raw: (input.raw ?? null) as object | null };
    const [result] = await tx.insert(screeningResults).values({ applicationId: application.id, ...resultValues }).onConflictDoUpdate({ target: screeningResults.applicationId, set: resultValues }).returning();
    await tx.insert(applicationStatusHistory).values({
      applicationId: application.id,
      stage: "resume_review",
      previousStage: "",
      newStage: "resume_review",
      decision: input.recommendation || "pending",
      comments: input.summary || "Screening result persisted; awaiting HR review.",
      source: "internal_api:screening",
      actionRequestId: `email:screening_next_step:${input.applicationExternalId}`,
      notificationStatus: "pending",
      notificationEventType: "screening_next_step",
      notificationRecipient: PILOT_EMAIL_RECIPIENT,
      notificationIntendedRecipient: application.email,
    }).onConflictDoNothing({ target: applicationStatusHistory.actionRequestId });
    return { result, error: null };
  });
}

export async function listScreening(applicationExternalId?: string) {
  const db = getDb();
  const query = db.select({ result: screeningResults, applicationExternalId: applications.externalId }).from(screeningResults).innerJoin(applications, eq(applications.id, screeningResults.applicationId));
  return (applicationExternalId ? query.where(eq(applications.externalId, applicationExternalId)) : query).orderBy(desc(screeningResults.createdAt)).limit(LIMIT);
}

export async function createScreeningInvitation(input: { roleExternalId: string; tokenHash: string; email: string; createdBy: string; expiresAt?: string }) {
  const db = getDb();
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.externalId, input.roleExternalId)).limit(1);
  if (!role) return { invitation: null, created: false, error: "unknown_role" as const };
  const [invitation] = await db.insert(screeningInvitations).values({ roleId: role.id, tokenHash: input.tokenHash, email: input.email.trim().toLowerCase(), createdBy: input.createdBy, expiresAt: isoOrNull(input.expiresAt) }).onConflictDoNothing({ target: screeningInvitations.tokenHash }).returning();
  return { invitation: invitation ?? null, created: Boolean(invitation), error: null };
}

export async function getScreeningInvitation(tokenHash: string) {
  const db = getDb();
  const [row] = await db.select({ invitation: screeningInvitations, roleExternalId: roles.externalId, roleTitle: roles.title })
    .from(screeningInvitations).innerJoin(roles, eq(roles.id, screeningInvitations.roleId))
    .where(eq(screeningInvitations.tokenHash, tokenHash.trim())).limit(1);
  return row ?? null;
}

export async function markScreeningInvitationUsed(tokenHash: string, applicationExternalId: string) {
  const db = getDb();
  const [application] = await db.select({ id: applications.id }).from(applications).where(eq(applications.externalId, applicationExternalId.trim())).limit(1);
  if (!application) return { updated: false, error: "unknown_application" as const };
  const [row] = await db.update(screeningInvitations).set({ status: "used", usedAt: new Date(), applicationId: application.id }).where(and(eq(screeningInvitations.tokenHash, tokenHash.trim()), eq(screeningInvitations.status, "active"))).returning({ id: screeningInvitations.id });
  return { updated: Boolean(row), error: null };
}

/** Claim due voice rows atomically; concurrent workers receive disjoint rows. */
export async function claimVoiceCalls(limit = 10) {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(LIMIT, Math.trunc(limit)));
  const result = await db.execute(sql`WITH claimed AS (SELECT id FROM voice_call_attempts WHERE status IN ('scheduled','queued','retry_scheduled') AND (scheduled_at IS NULL OR scheduled_at <= now()) ORDER BY scheduled_at NULLS FIRST, created_at FOR UPDATE SKIP LOCKED LIMIT ${safeLimit}) UPDATE voice_call_attempts v SET status = 'calling', updated_at = now() FROM claimed c WHERE v.id = c.id RETURNING v.id, v.application_id AS "applicationId", v.attempt_number AS "attemptNumber", v.max_attempts AS "maxAttempts", v.status, v.scheduled_at AS "scheduledAt"`);
  return rowsOf<Record<string, unknown>>(result);
}

export async function pendingVoiceCalls() {
  const db = getDb();
  return db.select({ id: voiceCallAttempts.id, applicationId: voiceCallAttempts.applicationId, externalId: applications.externalId, candidateName: applications.candidateName, email: applications.email, preferredMobile: voiceCallAttempts.preferredMobile, contactNumber: voiceCallAttempts.contactNumber, applicantCountry: voiceCallAttempts.applicantCountry, attemptNumber: voiceCallAttempts.attemptNumber, maxAttempts: voiceCallAttempts.maxAttempts, scheduledAt: voiceCallAttempts.scheduledAt, status: voiceCallAttempts.status }).from(voiceCallAttempts).innerJoin(applications, eq(applications.id, voiceCallAttempts.applicationId)).where(and(inArray(voiceCallAttempts.status, ["scheduled", "queued", "retry_scheduled"]), or(isNull(voiceCallAttempts.scheduledAt), lte(voiceCallAttempts.scheduledAt, sql`now()`)))).orderBy(asc(voiceCallAttempts.scheduledAt)).limit(LIMIT);
}

export async function dispatchVoiceAttemptDryRun(input: { attemptId: string; providerCallId: string }) {
  const db = getDb();
  const result = await db.execute(sql`UPDATE voice_call_attempts SET status = 'initiated', provider_call_id = ${input.providerCallId}, updated_at = now() WHERE id = ${input.attemptId} AND status = 'calling' RETURNING id, application_id AS "applicationId", provider_call_id AS "providerCallId", status`);
  return rowsOf<Record<string, unknown>>(result)[0] || null;
}

export async function voiceAttemptContext(attemptId: string) {
  const db = getDb();
  const [row] = await db.select({
    attempt: voiceCallAttempts,
    applicationExternalId: applications.externalId,
    candidateName: applications.candidateName,
    candidateEmail: applications.email,
    phone: applications.phone,
    preferredMobile: applications.preferredMobile,
    applicantCountry: applications.applicantCountry,
    roleExternalId: roles.externalId,
    roleTitle: roles.title,
  }).from(voiceCallAttempts)
    .innerJoin(applications, eq(applications.id, voiceCallAttempts.applicationId))
    .leftJoin(roles, eq(roles.id, voiceCallAttempts.roleId))
    .where(eq(voiceCallAttempts.id, attemptId.trim()))
    .limit(1);
  return row ?? null;
}

export async function updateVoiceAttemptStatus(input: { attemptId: string; status: string; outcome?: string; providerCallId?: string; retryAfter?: string }) {
  if (!Object.prototype.hasOwnProperty.call(VOICE_STATUS_TRANSITIONS, input.status)) return { updated: false, error: "invalid_status" as const };
  const db = getDb();
  const previousStatuses = Object.entries(VOICE_STATUS_TRANSITIONS).filter(([, next]) => next.includes(input.status)).map(([status]) => status);
  const allowedWhere = previousStatuses.length > 0 ? sql`status IN (${sql.join(previousStatuses.map((status) => sql`${status}`), sql`, `)})` : sql`false`;
  const result = await db.execute(sql`UPDATE voice_call_attempts SET status = ${input.status}, outcome = ${input.outcome || null}, provider_call_id = COALESCE(NULLIF(${input.providerCallId || ""}, ''), provider_call_id), retry_after = ${isoOrNull(input.retryAfter)}, updated_at = now() WHERE id = ${input.attemptId} AND (status = ${input.status} OR ${allowedWhere}) RETURNING id`);
  return { updated: rowsOf(result).length > 0, error: null };
}

export async function scheduleVoiceRetry(input: { attemptId: string; retryAfter: string }) {
  const db = getDb();
  const retryAt = isoOrNull(input.retryAfter);
  if (!retryAt) return { scheduled: false, duplicate: false, terminal: false, error: "retryAfter_required" as const };
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(voiceCallAttempts).where(eq(voiceCallAttempts.id, input.attemptId.trim())).for("update").limit(1);
    if (!current) return { scheduled: false, duplicate: false, terminal: false, error: "attempt_not_found" as const };
    if (current.status === "retry_scheduled") return { scheduled: false, duplicate: true, terminal: false, error: null };
    if (current.status !== "no_show") return { scheduled: false, duplicate: false, terminal: false, error: "invalid_retry_transition" as const };
    const [application] = await tx.select({ id: applications.id, email: applications.email }).from(applications).where(eq(applications.id, current.applicationId)).limit(1);
    if (!application) return { scheduled: false, duplicate: false, terminal: false, error: "application_not_found" as const };
    await tx.insert(applicationStatusHistory).values({
      applicationId: current.applicationId,
      stage: "voice_no_show",
      previousStage: "voice_scheduled",
      newStage: "voice_no_show",
      source: "internal_api:voice_retry",
      actionRequestId: `email:voice_no_show:${current.id}`,
      notificationStatus: "pending",
      notificationEventType: "voice_no_show",
      notificationRecipient: PILOT_EMAIL_RECIPIENT,
      notificationIntendedRecipient: application.email,
    }).onConflictDoNothing({ target: applicationStatusHistory.actionRequestId });
    if (current.attemptNumber >= current.maxAttempts) return { scheduled: false, duplicate: false, terminal: true, error: null };
    const nextAttemptNumber = current.attemptNumber + 1;
    const [existing] = await tx.select({ id: voiceCallAttempts.id, status: voiceCallAttempts.status }).from(voiceCallAttempts).where(and(eq(voiceCallAttempts.applicationId, current.applicationId), eq(voiceCallAttempts.attemptNumber, nextAttemptNumber))).limit(1);
    if (existing) return { scheduled: false, duplicate: true, terminal: false, error: null };
    const [next] = await tx.insert(voiceCallAttempts).values({
      applicationId: current.applicationId,
      roleId: current.roleId,
      attemptNumber: nextAttemptNumber,
      maxAttempts: current.maxAttempts,
      scheduledAt: retryAt,
      retryAfter: retryAt,
      status: "retry_scheduled",
      preferredMobile: current.preferredMobile,
      contactNumber: current.contactNumber,
      applicantCountry: current.applicantCountry,
    }).returning({ id: voiceCallAttempts.id, attemptNumber: voiceCallAttempts.attemptNumber, status: voiceCallAttempts.status, scheduledAt: voiceCallAttempts.scheduledAt });
    if (next) {
      await tx.insert(applicationStatusHistory).values({
        applicationId: current.applicationId,
        stage: "voice_retry",
        previousStage: "voice_no_show",
        newStage: "voice_retry",
        source: "internal_api:voice_retry",
        actionRequestId: `email:voice_retry:${next.id}`,
        notificationStatus: "pending",
        notificationEventType: "voice_retry",
        notificationRecipient: PILOT_EMAIL_RECIPIENT,
        notificationIntendedRecipient: application.email,
      }).onConflictDoNothing({ target: applicationStatusHistory.actionRequestId });
    }
    return { scheduled: Boolean(next), duplicate: false, terminal: false, error: null, next };
  });
}

export async function ingestVoiceResult(input: { applicationExternalId: string; attemptId?: string; score?: number | null; recommendation?: string; strengths?: string; concerns?: string; summary?: string; transcript?: string; callStatus?: string; callFinalStatus?: string; providerEventType?: string; callCompletedAt?: string; raw?: unknown; sourceEventKey?: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [application] = await tx.select({ id: applications.id, email: applications.email }).from(applications).where(eq(applications.externalId, input.applicationExternalId)).for("update").limit(1);
    if (!application) return { inserted: false, applicationId: null, error: "unknown_application" as const };
    const completedAt = isoOrNull(input.callCompletedAt);
    const existing = await tx.select({ id: voiceInterviewResults.id }).from(voiceInterviewResults).where(and(eq(voiceInterviewResults.applicationId, application.id), eq(voiceInterviewResults.providerEventType, input.providerEventType || ""), completedAt ? eq(voiceInterviewResults.callCompletedAt, completedAt) : isNull(voiceInterviewResults.callCompletedAt))).limit(1);
    if (existing.length > 0) return { inserted: false, applicationId: application.id, error: null };
    const [result] = await tx.insert(voiceInterviewResults).values({ applicationId: application.id, attemptId: input.attemptId || null, score: input.score ?? null, recommendation: input.recommendation || "", strengths: input.strengths || "", concerns: input.concerns || "", summary: input.summary || "", transcript: input.transcript || "", callStatus: input.callStatus || "", callFinalStatus: input.callFinalStatus || "", providerEventType: input.providerEventType || "", callCompletedAt: completedAt, resultReceivedAt: new Date(), raw: (input.raw ?? null) as object | null }).returning();
    await tx.update(applications).set({ currentStage: "voice_review_pending", updatedAt: new Date() }).where(and(eq(applications.id, application.id), eq(applications.currentStage, "voice_scheduled")));
    await tx.insert(applicationStatusHistory).values({ applicationId: application.id, stage: "voice_review_pending", previousStage: "voice_scheduled", newStage: "voice_review_pending", decision: input.recommendation || "", source: "internal_api:voice_result", comments: input.summary || "", actionRequestId: input.sourceEventKey || null, notificationStatus: "pending", notificationEventType: "voice_result_next_step", notificationRecipient: PILOT_EMAIL_RECIPIENT, notificationIntendedRecipient: application.email }).onConflictDoNothing({ target: applicationStatusHistory.actionRequestId });
    return { inserted: Boolean(result), applicationId: application.id, error: null };
  });
}

export async function voiceResultStatuses(applicationExternalIds: string[]) {
  const db = getDb();
  if (applicationExternalIds.length === 0) return [];
  return db.select({ externalId: applications.externalId, currentStage: applications.currentStage, voiceHrDecision: applications.voiceHrDecision, latestResultAt: sql<string>`max(${voiceInterviewResults.createdAt})` }).from(applications).leftJoin(voiceInterviewResults, eq(voiceInterviewResults.applicationId, applications.id)).where(inArray(applications.externalId, applicationExternalIds)).groupBy(applications.externalId, applications.currentStage, applications.voiceHrDecision);
}

export async function createVoiceCallLog(input: { applicationExternalId: string; voiceCallAttemptId?: string; provider?: string; providerCallId?: string; providerEventId?: string; sourceEventKey: string; callStatus?: string; durationSeconds?: number | null; recordingUrl?: string; communicationScore?: number | null; completenessScore?: number | null; transcript?: string; summary?: string; recommendation?: string; errorDetails?: string; rawResult?: unknown; startedAt?: string; endedAt?: string }) {
  const db = getDb();
  const [application] = await db.select({ id: applications.id }).from(applications).where(eq(applications.externalId, input.applicationExternalId)).limit(1);
  if (!application) return { log: null, created: false, error: "unknown_application" as const };
  const [log] = await db.insert(voiceCallLogs).values({ applicationId: application.id, voiceCallAttemptId: input.voiceCallAttemptId || null, provider: input.provider || "", providerCallId: input.providerCallId || "", providerEventId: input.providerEventId || "", sourceEventKey: input.sourceEventKey, callStatus: input.callStatus || "", durationSeconds: input.durationSeconds ?? null, recordingUrl: input.recordingUrl || "", communicationScore: input.communicationScore ?? null, completenessScore: input.completenessScore ?? null, transcript: input.transcript || "", summary: input.summary || "", recommendation: input.recommendation || "", errorDetails: input.errorDetails || "", rawResult: (input.rawResult ?? null) as object | null, startedAt: isoOrNull(input.startedAt), endedAt: isoOrNull(input.endedAt) }).onConflictDoNothing({ target: voiceCallLogs.sourceEventKey }).returning();
  return { log: log ?? null, created: Boolean(log), error: null };
}

export async function hrDecisionQueue(stage?: "resume" | "voice" | "final") {
  const db = getDb();
  const stageFilter = stage === "resume" ? ["resume_review"] : stage === "voice" ? ["voice_review_pending"] : stage === "final" ? ["final_decision_pending"] : ["resume_review", "voice_review_pending", "final_decision_pending"];
  return db.select({ externalId: applications.externalId, roleId: applications.roleId, candidateName: applications.candidateName, email: applications.email, currentStage: applications.currentStage, resumeHrDecision: applications.resumeHrDecision, voiceHrDecision: applications.voiceHrDecision, finalHrDecision: applications.finalHrDecision, updatedAt: applications.updatedAt }).from(applications).where(and(eq(applications.withdrawn, false), inArray(applications.currentStage, stageFilter))).orderBy(desc(applications.updatedAt)).limit(LIMIT);
}

export async function applyHrDecision(input: { applicationExternalId: string; stage: "resume" | "voice" | "final"; decision: string; comments?: string; actorEmail: string; actorName?: string; actionRequestId: string }) {
  const db = getDb();
  if (!isValidDecision(input.decision)) return { updated: false, error: "invalid_decision" as const };
  const expectedStage = input.stage === "resume" ? "resume_review" : input.stage === "voice" ? "voice_review_pending" : "final_decision_pending";
  const targetStage = input.decision === "reject" ? "rejected" : input.decision === "approve" ? (input.stage === "resume" ? "resume_approved" : input.stage === "voice" ? "approved_for_final" : "passed_final") : expectedStage;
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(applications).where(eq(applications.externalId, input.applicationExternalId)).for("update").limit(1);
    if (!current) return { updated: false, error: "unknown_application" as const };
    if (current.currentStage !== expectedStage) return { updated: false, error: "invalid_transition" as const };
    const [history] = await tx.select({ id: applicationStatusHistory.id }).from(applicationStatusHistory).where(eq(applicationStatusHistory.actionRequestId, input.actionRequestId)).limit(1);
    if (history) return { updated: false, duplicate: true, error: null };
    const patch = input.stage === "resume" ? { resumeHrDecision: input.decision, resumeHrDecisionAt: new Date(), resumeHrReviewer: input.actorEmail, resumeHrComments: input.comments || "" } : input.stage === "voice" ? { voiceHrDecision: input.decision, voiceHrComments: input.comments || "" } : { finalHrDecision: input.decision, finalInterviewComments: input.comments || "" };
    await tx.update(applications).set({ ...patch, currentStage: targetStage, updatedAt: new Date() }).where(eq(applications.id, current.id));
    const notificationEventType = input.stage === "voice" && input.decision === "reject" ? "voice_rejection" : input.stage === "final" && input.decision === "approve" ? "final_decision_pass" : input.stage === "final" && input.decision === "reject" ? "final_decision_reject" : "";
    await tx.insert(applicationStatusHistory).values({ applicationId: current.id, stage: input.stage, previousStage: current.currentStage, newStage: targetStage, decision: input.decision, actorEmail: input.actorEmail, actorName: input.actorName || "", comments: input.comments || "", source: "internal_api:hr_decision", actionRequestId: input.actionRequestId, notificationStatus: notificationEventType ? "pending" : "", notificationEventType, notificationRecipient: notificationEventType ? PILOT_EMAIL_RECIPIENT : "", notificationIntendedRecipient: notificationEventType ? current.email : "" });
    return { updated: true, duplicate: false, error: null };
  });
}

export async function listApplicationHistory(externalId?: string) {
  const db = getDb();
  const query = db.select({ history: applicationStatusHistory, externalId: applications.externalId }).from(applicationStatusHistory).innerJoin(applications, eq(applications.id, applicationStatusHistory.applicationId));
  return (externalId ? query.where(eq(applications.externalId, externalId)) : query).orderBy(desc(applicationStatusHistory.changedAt)).limit(LIMIT);
}

export async function updateApplicationStage(input: { applicationExternalId: string; newStage: string; actorEmail?: string; actorName?: string; comments?: string; actionRequestId: string }) {
  const db = getDb();
  if (!isValidStage(input.newStage)) return { updated: false, error: "invalid_stage" as const };
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(applications).where(eq(applications.externalId, input.applicationExternalId)).for("update").limit(1);
    if (!current) return { updated: false, error: "unknown_application" as const };
    const [existing] = await tx.select({ id: applicationStatusHistory.id }).from(applicationStatusHistory).where(eq(applicationStatusHistory.actionRequestId, input.actionRequestId)).limit(1);
    if (existing) return { updated: false, duplicate: true, error: null };
    if (current.currentStage === input.newStage || !isValidTransition(current.currentStage, input.newStage)) return { updated: false, duplicate: false, error: "invalid_transition" as const };
    await tx.update(applications).set({ currentStage: input.newStage, withdrawn: input.newStage === "withdrawn", updatedAt: new Date() }).where(eq(applications.id, current.id));
    await tx.insert(applicationStatusHistory).values({ applicationId: current.id, stage: input.newStage, previousStage: current.currentStage, newStage: input.newStage, actorEmail: input.actorEmail || "", actorName: input.actorName || "", comments: input.comments || "", source: "internal_api:status", actionRequestId: input.actionRequestId });
    return { updated: true, duplicate: false, error: null };
  });
}

export async function bulkScreeningQueue(statuses: string[] = ["queued", "processing"]) {
  const db = getDb();
  return db.select().from(bulkScreeningQueueItems).where(inArray(bulkScreeningQueueItems.status, statuses)).orderBy(asc(bulkScreeningQueueItems.discoveredAt)).limit(LIMIT);
}

export async function listBulkQueueForPortal(statuses: string[] = ["queued", "processing", "screened", "failed", "skipped"], roleExternalId?: string) {
  const db = getDb();
  const conditions = [inArray(bulkScreeningQueueItems.status, statuses)];
  if (roleExternalId) conditions.push(eq(roles.externalId, roleExternalId.trim()));
  return db.select({ item: bulkScreeningQueueItems, roleExternalId: roles.externalId, applicationExternalId: applications.externalId })
    .from(bulkScreeningQueueItems)
    .innerJoin(roles, eq(roles.id, bulkScreeningQueueItems.roleId))
    .leftJoin(applications, eq(applications.id, bulkScreeningQueueItems.applicationId))
    .where(and(...conditions))
    .orderBy(desc(bulkScreeningQueueItems.updatedAt))
    .limit(LIMIT);
}

export async function enqueueBulkScreening(input: {
  roleExternalId: string;
  batchId?: string;
  dedupeKey: string;
  resumeSha256: string;
  driveFileId: string;
  filename: string;
  fileUrl?: string;
  mimeType?: string;
  candidateName?: string;
  candidateEmail?: string;
  preferredMobile?: string;
  applicantCountry?: string;
  source?: "upload" | "drive" | "onedrive";
  environment?: string;
  isUat?: boolean;
  jobId?: string;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.externalId, input.roleExternalId.trim())).limit(1);
    if (!role) return { item: null, created: false, error: "unknown_role" as const };
    const [item] = await tx.insert(bulkScreeningQueueItems).values({
      roleId: role.id, batchId: input.batchId || "", dedupeKey: input.dedupeKey.trim(), resumeSha256: input.resumeSha256.trim().toLowerCase(),
      driveFileId: input.driveFileId.trim(), filename: input.filename.trim(), fileUrl: input.fileUrl || "", mimeType: input.mimeType || "",
      candidateName: input.candidateName || "", candidateEmail: input.candidateEmail || "", preferredMobile: input.preferredMobile || "", applicantCountry: input.applicantCountry || "",
      source: input.source || "", environment: input.environment || "", isUat: input.isUat ?? false, jobId: input.jobId || "",
    }).onConflictDoNothing({ target: [bulkScreeningQueueItems.roleId, bulkScreeningQueueItems.resumeSha256] }).returning();
    if (item) return { item, created: true, error: null };
    const [existing] = await tx.select().from(bulkScreeningQueueItems).where(and(eq(bulkScreeningQueueItems.roleId, role.id), eq(bulkScreeningQueueItems.resumeSha256, input.resumeSha256.trim().toLowerCase()))).limit(1);
    return { item: existing ?? null, created: false, error: null };
  });
}

/** Claim bulk rows atomically; a row can never be claimed twice concurrently. */
export async function claimBulkQueue(limit = 10) {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(LIMIT, Math.trunc(limit)));
  const result = await db.execute(sql`WITH claimed AS (
    SELECT id FROM bulk_screening_queue_items
    WHERE status = 'queued'
       OR (status = 'processing' AND (processing_started_at IS NULL OR processing_started_at < now() - interval '5 minutes'))
    ORDER BY discovered_at, id
    FOR UPDATE SKIP LOCKED LIMIT ${safeLimit}
  )
  UPDATE bulk_screening_queue_items q
  SET status = 'processing', processing_started_at = now(), attempt_count = q.attempt_count + 1, updated_at = now()
  FROM claimed c WHERE q.id = c.id
  RETURNING q.id, q.dedupe_key AS "dedupeKey", q.batch_id AS "batchId", q.status, q.attempt_count AS "attemptCount"`);
  return rowsOf<Record<string, unknown>>(result);
}

/** Claim one known queue item without allowing a concurrent second claim. */
export async function claimBulkQueueItem(dedupeKey: string) {
  const db = getDb();
  const result = await db.execute(sql`WITH claimed AS (
    SELECT id FROM bulk_screening_queue_items
    WHERE dedupe_key = ${dedupeKey.trim()} AND status IN ('queued', 'failed')
    FOR UPDATE SKIP LOCKED
  )
  UPDATE bulk_screening_queue_items q
  SET status = 'processing', processing_started_at = now(), attempt_count = q.attempt_count + 1, updated_at = now()
  FROM claimed c WHERE q.id = c.id
  RETURNING q.id, q.dedupe_key AS "dedupeKey", q.status, q.attempt_count AS "attemptCount"`);
  return rowsOf<Record<string, unknown>>(result)[0] ?? null;
}

export async function getBulkScreeningContext(dedupeKey: string) {
  const db = getDb();
  const [row] = await db.select({
    item: bulkScreeningQueueItems,
    role: roles,
    application: applications,
    resumeFile: resumeFiles,
  })
    .from(bulkScreeningQueueItems)
    .innerJoin(roles, eq(roles.id, bulkScreeningQueueItems.roleId))
    .leftJoin(applications, eq(applications.id, bulkScreeningQueueItems.applicationId))
    .leftJoin(resumeFiles, eq(resumeFiles.id, applications.resumeFileId))
    .where(eq(bulkScreeningQueueItems.dedupeKey, dedupeKey.trim()))
    .limit(1);
  return row ?? null;
}

/**
 * Persist a validated screening result, status history, queue completion, and
 * its one-time credit deduction in one Postgres transaction. A failed credit
 * guard rolls back the result and queue update, so failed screening is free.
 */
export async function finalizeBulkScreening(input: {
  dedupeKey: string;
  screening: {
    matchScore: number;
    recommendation: string;
    summary: string;
    strengths: string;
    gaps: string;
    interviewQuestions: string;
    evaluationScores: unknown;
    raw?: unknown;
  };
  ledger: LedgerAppend;
  actorEmail?: string;
  actorName?: string;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [queue] = await tx.select().from(bulkScreeningQueueItems)
      .where(eq(bulkScreeningQueueItems.dedupeKey, input.dedupeKey.trim()))
      .for("update").limit(1);
    if (!queue) return { processed: false, duplicate: false, error: "unknown_queue" as const };
    if (queue.status === "screened") return { processed: false, duplicate: true, error: null };
    if (queue.status !== "processing") return { processed: false, duplicate: false, error: "queue_not_claimed" as const };
    if (!queue.applicationId) return { processed: false, duplicate: false, error: "missing_application" as const };

    const [application] = await tx.select().from(applications)
      .where(eq(applications.id, queue.applicationId)).for("update").limit(1);
    if (!application) return { processed: false, duplicate: false, error: "missing_application" as const };

    const [existing] = await tx.select({ id: screeningResults.id }).from(screeningResults)
      .where(eq(screeningResults.applicationId, application.id)).limit(1);
    if (existing) return { processed: false, duplicate: true, error: null };

    const [result] = await tx.insert(screeningResults).values({
      applicationId: application.id,
      matchScore: input.screening.matchScore,
      recommendation: input.screening.recommendation,
      summary: input.screening.summary,
      strengths: input.screening.strengths,
      gaps: input.screening.gaps,
      interviewQuestions: input.screening.interviewQuestions,
      evaluationScores: input.screening.evaluationScores as object,
      screenedAt: new Date(),
      raw: (input.screening.raw ?? null) as object | null,
    }).onConflictDoNothing({ target: screeningResults.applicationId }).returning();
    if (!result) return { processed: false, duplicate: true, error: null };

    const credit = await appendPostgresLedgerEntryOnExecutor(tx, input.ledger, { guard: true });
    const actionRequestId = `screening:${input.dedupeKey.trim()}`;
    await tx.insert(applicationStatusHistory).values({
      applicationId: application.id,
      stage: "resume_review",
      previousStage: application.currentStage,
      newStage: application.currentStage,
      decision: "pending",
      actorName: input.actorName || "",
      actorEmail: input.actorEmail || "",
      comments: "Automated screening completed; awaiting HR review.",
      source: "target:bulk_screening",
      actionRequestId,
      notificationStatus: "pending",
      notificationEventType: "screening_next_step",
      notificationRecipient: PILOT_EMAIL_RECIPIENT,
      notificationIntendedRecipient: application.email,
    }).onConflictDoNothing({ target: applicationStatusHistory.actionRequestId });
    await tx.update(applications).set({ updatedAt: new Date() }).where(eq(applications.id, application.id));
    await tx.update(bulkScreeningQueueItems).set({ status: "screened", errorMessage: "", processedAt: new Date(), updatedAt: new Date() })
      .where(eq(bulkScreeningQueueItems.id, queue.id));
    return { processed: true, duplicate: false, error: null, result, credit };
  });
}

export async function updateBulkQueueStatus(input: { dedupeKey: string; status: string; applicationId?: string; errorMessage?: string }) {
  const allowed = ["queued", "processing", "screened", "failed", "skipped"];
  if (!allowed.includes(input.status)) return { updated: false, error: "invalid_status" as const };
  const db = getDb();
  const result = await db.execute(sql`UPDATE bulk_screening_queue_items SET status = ${input.status}, application_id = COALESCE(${input.applicationId || null}, application_id), error_message = ${input.errorMessage || ""}, processed_at = CASE WHEN ${input.status} IN ('screened','failed','skipped') THEN now() ELSE processed_at END, updated_at = now() WHERE dedupe_key = ${input.dedupeKey} RETURNING id`);
  return { updated: rowsOf(result).length > 0, error: null };
}

export async function listBookingSlots(kind?: string, roleExternalId?: string) {
  const db = getDb();
  const conditions = [eq(interviewSlots.status, "available")];
  if (kind) conditions.push(eq(interviewSlots.interviewType, kind));
  if (!roleExternalId) return db.select().from(interviewSlots).where(and(...conditions)).orderBy(asc(interviewSlots.startsAt)).limit(LIMIT);
  return db.select({ slot: interviewSlots, roleExternalId: roles.externalId }).from(interviewSlots).leftJoin(roles, eq(roles.id, interviewSlots.roleId)).where(and(...conditions, eq(roles.externalId, roleExternalId))).orderBy(asc(interviewSlots.startsAt)).limit(LIMIT);
}

export async function listApplicationSlots(applicationExternalId: string, kind?: string) {
  const db = getDb();
  const conditions = [eq(applications.externalId, applicationExternalId.trim())];
  if (kind) conditions.push(eq(interviewSlots.interviewType, kind));
  return db.select({ slot: interviewSlots, roleExternalId: roles.externalId })
    .from(interviewSlots)
    .innerJoin(applications, eq(applications.id, interviewSlots.applicationId))
    .leftJoin(roles, eq(roles.id, interviewSlots.roleId))
    .where(and(...conditions))
    .orderBy(desc(interviewSlots.updatedAt))
    .limit(LIMIT);
}

export async function createInterviewSlot(input: {
  slotCode?: string;
  interviewType: "voice" | "final";
  roleExternalId?: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
}) {
  const db = getDb();
  const startsAt = isoOrNull(input.startsAt);
  const endsAt = isoOrNull(input.endsAt);
  if (!startsAt || !endsAt || endsAt <= startsAt) return { slot: null, error: "invalid_time_range" as const };
  let roleId: string | null = null;
  if (input.roleExternalId) {
    const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.externalId, input.roleExternalId.trim())).limit(1);
    if (!role) return { slot: null, error: "unknown_role" as const };
    roleId = role.id;
  }
  const [slot] = await db.insert(interviewSlots).values({ slotCode: input.slotCode?.trim() || null, interviewType: input.interviewType, roleId, startsAt, endsAt, timezone: input.timezone.trim(), status: "available" }).onConflictDoNothing({ target: interviewSlots.slotCode }).returning();
  if (slot) return { slot, created: true, error: null };
  const [existing] = input.slotCode ? await db.select().from(interviewSlots).where(eq(interviewSlots.slotCode, input.slotCode.trim())).limit(1) : [];
  return { slot: existing ?? null, created: false, error: null };
}

export async function bookInterviewSlot(input: { slotId: string; applicationExternalId: string; actorEmail: string; actionRequestId: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [application] = await tx.select({ id: applications.id, candidateName: applications.candidateName, email: applications.email }).from(applications).where(eq(applications.externalId, input.applicationExternalId)).limit(1);
    if (!application) return { booked: false, error: "unknown_application" as const };
    const [slot] = await tx.update(interviewSlots).set({ status: "booked", applicationId: application.id, candidateName: application.candidateName, candidateEmail: application.email, bookedAt: new Date(), updatedAt: new Date() }).where(and(eq(interviewSlots.id, input.slotId), eq(interviewSlots.status, "available"))).returning();
    if (!slot) return { booked: false, error: "slot_unavailable" as const };
    const nextStage = slot.interviewType === "voice" ? "voice_scheduled" : "final_scheduled";
    const previousStage = slot.interviewType === "voice" ? "voice_booking_pending" : "approved_for_final";
    await tx.update(applications).set({ currentStage: nextStage, updatedAt: new Date() }).where(eq(applications.id, application.id));
    await tx.insert(applicationStatusHistory).values({ applicationId: application.id, stage: slot.interviewType, previousStage, newStage: nextStage, actorEmail: input.actorEmail, source: "internal_api:booking", actionRequestId: input.actionRequestId, notificationStatus: "pending", notificationEventType: slot.interviewType === "voice" ? "voice_booking_confirmation" : "final_booking_confirmation", notificationRecipient: PILOT_EMAIL_RECIPIENT, notificationIntendedRecipient: application.email });
    if (slot.interviewType === "voice") {
      const existing = await tx.select({ id: voiceCallAttempts.id }).from(voiceCallAttempts).where(and(eq(voiceCallAttempts.applicationId, application.id), inArray(voiceCallAttempts.status, ["scheduled", "queued", "calling", "initiated", "in_progress"]))).limit(1);
      if (existing.length === 0) {
        await tx.insert(voiceCallAttempts).values({ applicationId: application.id, roleId: slot.roleId, attemptNumber: 1, maxAttempts: 3, scheduledAt: slot.startsAt, status: "scheduled", preferredMobile: "", contactNumber: "" });
      }
    }
    return { booked: true, slot, error: null };
  });
}

export async function createBookingToken(input: { applicationExternalId: string; kind: "voice" | "final"; tokenHash: string; link?: string; expiresAt?: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [application] = await tx.select({ id: applications.id, currentStage: applications.currentStage, email: applications.email }).from(applications).where(eq(applications.externalId, input.applicationExternalId)).limit(1);
    if (!application) return { token: null, created: false, notificationHistoryId: null, error: "unknown_application" as const };
    const [token] = await tx.insert(bookingTokens).values({ applicationId: application.id, kind: input.kind, tokenHash: input.tokenHash, link: input.link || "", expiresAt: isoOrNull(input.expiresAt) }).onConflictDoNothing({ target: bookingTokens.tokenHash }).returning();
    if (!token) {
      const [existing] = await tx.select().from(bookingTokens).where(eq(bookingTokens.tokenHash, input.tokenHash)).limit(1);
      return { token: existing ?? null, created: false, notificationHistoryId: null, error: null };
    }
    const [history] = await tx.insert(applicationStatusHistory).values({
      applicationId: application.id,
      stage: input.kind,
      previousStage: application.currentStage,
      newStage: application.currentStage,
      source: `internal_api:${input.kind}_booking_invitation`,
      actionRequestId: `booking-invitation:${input.kind}:${input.applicationExternalId}`,
      notificationStatus: "pending",
      notificationEventType: input.kind === "voice" ? "voice_booking_invitation" : "final_booking_invitation",
      notificationRecipient: PILOT_EMAIL_RECIPIENT,
      notificationIntendedRecipient: application.email,
    }).onConflictDoNothing({ target: applicationStatusHistory.actionRequestId }).returning({ id: applicationStatusHistory.id });
    return { token, created: true, notificationHistoryId: history?.id || null, error: null };
  });
}

export async function getBookingToken(tokenHash: string) {
  const db = getDb();
  const [token] = await db.select({ token: bookingTokens, applicationExternalId: applications.externalId }).from(bookingTokens).innerJoin(applications, eq(applications.id, bookingTokens.applicationId)).where(eq(bookingTokens.tokenHash, tokenHash.trim())).limit(1);
  return token ?? null;
}

export async function markBookingTokenUsed(tokenHash: string) {
  const db = getDb();
  const [token] = await db.update(bookingTokens).set({ status: "used", usedAt: new Date() }).where(and(eq(bookingTokens.tokenHash, tokenHash.trim()), inArray(bookingTokens.status, ["pending", "active"]))).returning({ id: bookingTokens.id });
  return { updated: Boolean(token) };
}

export async function listActiveBookingRoleIds() {
  const db = getDb();
  return db.select({ roleExternalId: roles.externalId, kind: bookingTokens.kind })
    .from(bookingTokens)
    .innerJoin(applications, eq(applications.id, bookingTokens.applicationId))
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .where(and(inArray(bookingTokens.status, ["pending", "active"]), or(isNull(bookingTokens.expiresAt), sql`${bookingTokens.expiresAt} >= now()`)))
    .limit(LIMIT);
}

export async function notificationQueue(stage?: string) {
  const db = getDb();
  const rows = await db.select({
    history: applicationStatusHistory,
    applicationExternalId: applications.externalId,
    candidateName: applications.candidateName,
    candidateEmail: applications.email,
    notificationLink: sql<string>`COALESCE((SELECT bt.link FROM booking_tokens bt WHERE bt.application_id = ${applications.id} AND bt.kind = CASE WHEN ${applicationStatusHistory.notificationEventType} = 'voice_booking_invitation' THEN 'voice' WHEN ${applicationStatusHistory.notificationEventType} = 'final_booking_invitation' THEN 'final' ELSE '' END ORDER BY bt.created_at DESC LIMIT 1), '')`,
    roleExternalId: roles.externalId,
    roleTitle: roles.title,
  }).from(applicationStatusHistory)
    .innerJoin(applications, eq(applications.id, applicationStatusHistory.applicationId))
    .leftJoin(roles, eq(roles.id, applications.roleId))
    .where(and(
      inArray(applicationStatusHistory.notificationStatus, ["", "pending", "failed"]),
      stage?.trim() ? eq(applicationStatusHistory.newStage, stage.trim()) : undefined,
    ))
    .orderBy(asc(applicationStatusHistory.changedAt)).limit(LIMIT);
  return rows.map(({ history, ...context }) => ({ ...history, ...context }));
}

export async function markNotification(input: { historyId: string; status: "sent" | "pending" | "failed" | "not_configured"; error?: string; providerMessageId?: string; recipient?: string }) {
  const db = getDb();
  const [row] = await db.update(applicationStatusHistory).set({ notificationStatus: input.status, notificationError: input.error || "", notificationAttemptedAt: new Date(), notificationSentAt: input.status === "sent" ? new Date() : undefined, notificationProviderId: input.providerMessageId || "", notificationRecipient: input.recipient || undefined }).where(eq(applicationStatusHistory.id, input.historyId)).returning({ id: applicationStatusHistory.id });
  return { updated: Boolean(row) };
}
