import crypto from "node:crypto";

import { and, asc, desc, eq, gte, inArray, isNull, lte, not, or, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { appendPostgresLedgerEntryOnExecutor } from "@/lib/ella-credits-postgres";
import { classifyVoiceInterviewBillingOutcome } from "@/lib/ella-credit-math";
import { recordVoiceInterviewDeduction } from "@/lib/ella-credits";
import { appendAccountLedgerEntryOnExecutor, perUserCreditsEnabled } from "@/lib/ella-credits-accounts";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organization-accounts";
import type { LedgerAppend } from "@/lib/ella-credits-store";
import { pilotEmailRecipient } from "@/lib/pilot-test-safety";
import { notificationEmail, notificationEventLabel, notificationStatusLabel, notificationSummary } from "@/lib/notification-labels";
import { avatarInterviewLink } from "@/lib/public-url";
import type { LiveAvatarEvaluation, LiveAvatarTranscriptTurn } from "@/lib/live-avatar-screening";
import {
  applicants,
  applicantAliases,
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
const configuredNotificationClaimLeaseMinutes = Number(process.env.NOTIFICATION_CLAIM_LEASE_MINUTES || "10");
const NOTIFICATION_CLAIM_LEASE_MINUTES = Number.isFinite(configuredNotificationClaimLeaseMinutes)
  ? Math.min(Math.max(configuredNotificationClaimLeaseMinutes, 1), 60)
  : 10;
// A worker outage must not turn a yesterday's appointment into an unexpected
// call when the queue comes back. Keep this configurable for environments
// with a different polling interval, but bound it to a safe operational range.
const configuredVoiceCallLateGraceMinutes = Number(process.env.VOICE_CALL_MAX_LATE_MINUTES || "15");
const VOICE_CALL_MAX_LATE_MINUTES = Number.isFinite(configuredVoiceCallLateGraceMinutes)
  ? Math.max(1, Math.min(60, Math.trunc(configuredVoiceCallLateGraceMinutes)))
  : 15;
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
  calling: ["dispatching", "initiated", "in_progress", "completed", "no_show", "cancelled", "failed"],
  dispatching: ["initiated", "failed", "cancelled"],
  initiated: ["in_progress", "completed", "no_show", "cancelled", "failed"],
  in_progress: ["completed", "no_show", "cancelled", "failed"],
  completed: [], no_show: [], cancelled: [], failed: [],
};
const ROLE_STATUSES = ["draft", "pending_hr_discussion", "approved", "recruitment_setup", "job_posted", "returned_for_revision", "on_hold", "rejected"] as const;
const RECRUITMENT_SETUP_STATUSES = ["draft", "recruitment_ready", "ready_for_publishing", "published"] as const;
export type BookingTokenKind = "voice" | "final" | "avatar";

function normalizedKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeRoleStatus(value: string | undefined) {
  const normalized = normalizedKey(value);
  return (ROLE_STATUSES as readonly string[]).includes(normalized) ? normalized : "draft";
}

function normalizeRequestType(value: string | undefined) {
  const normalized = normalizedKey(value);
  return normalized === "staff_addition" || normalized === "staff_replacement" ? normalized : "";
}

function normalizeRecruitmentSetupStatus(value: string | undefined) {
  const normalized = normalizedKey(value);
  return (RECRUITMENT_SETUP_STATUSES as readonly string[]).includes(normalized) ? normalized : "draft";
}

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

/** Promote a temporary draft external ID without changing the stable row UUID. */
export async function renameRoleExternalId(input: { currentExternalId: string; nextExternalId: string; actorEmail?: string }) {
  const db = getDb();
  const currentExternalId = input.currentExternalId.trim();
  const nextExternalId = input.nextExternalId.trim();
  if (!currentExternalId || !nextExternalId) return { renamed: false, error: "invalid_role_id" as const };
  if (currentExternalId === nextExternalId) return { renamed: false, error: null };
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.externalId, currentExternalId)).for("update").limit(1);
    if (!current) return { renamed: false, error: "unknown_role" as const };
    const [conflict] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.externalId, nextExternalId)).limit(1);
    if (conflict) return { renamed: false, error: "role_id_conflict" as const };
    const [updated] = await tx.update(roles).set({ externalId: nextExternalId, updatedByEmail: input.actorEmail?.trim().toLowerCase() || "", updatedAt: new Date() }).where(eq(roles.id, current.id)).returning({ externalId: roles.externalId });
    return { renamed: Boolean(updated), error: null };
  });
}

export async function createRole(input: { externalId: string; title: string; code?: string; departmentSnapshot?: string; requestType?: string; vacancies?: number; reason?: string; targetHiringDate?: string; status?: string; recruitmentSetupStatus?: string; setup?: unknown; evaluationFields?: unknown; hrCalendarEmail?: string; source?: string; requesterEmail?: string; requesterName?: string; submittedByEmail?: string; actionRequestId?: string; actorEmail?: string; actorName?: string; organizationId?: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const organizationId = input.organizationId?.trim() || DEFAULT_ORGANIZATION_ID;
    const [role] = await tx.insert(roles).values({ organizationId, externalId: input.externalId.trim(), title: input.title.trim(), code: input.code?.trim() || null, departmentSnapshot: input.departmentSnapshot || "", requestType: normalizeRequestType(input.requestType), vacancies: input.vacancies ?? 1, reason: input.reason || "", targetHiringDate: input.targetHiringDate || null, status: normalizeRoleStatus(input.status), recruitmentSetupStatus: normalizeRecruitmentSetupStatus(input.recruitmentSetupStatus), setup: (input.setup || {}) as object, evaluationFields: (input.evaluationFields || []) as object, hrCalendarEmail: input.hrCalendarEmail || "", source: input.source || "internal_api", requesterEmail: input.requesterEmail || "", requesterName: input.requesterName || "", submittedByEmail: input.submittedByEmail || input.requesterEmail || "", updatedByEmail: input.actorEmail || "" }).onConflictDoNothing({ target: roles.externalId }).returning();
    if (!role) {
      const [existing] = await tx.select().from(roles).where(eq(roles.externalId, input.externalId.trim())).limit(1);
      return { role: existing ?? null, created: false };
    }
    await tx.insert(roleStatusHistory).values({ organizationId: role.organizationId, roleId: role.id, previousStatus: "", newStatus: role.status, action: "role_created", actionSource: "internal_api", actionRequestId: input.actionRequestId || null, changedByEmail: input.actorEmail || "", changedByName: input.actorName || "", notificationStatus: "pending" }).onConflictDoNothing({ target: roleStatusHistory.actionRequestId });
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
    await tx.insert(roleStatusHistory).values({ organizationId: current.organizationId, roleId: current.id, previousStatus: current.status, newStatus: input.newStatus, comments: input.comments || "", action: "status_update", actionSource: "internal_api", actionRequestId: input.actionRequestId, changedByEmail: input.actorEmail || "", changedByName: input.actorName || "", notificationStatus: "pending" });
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
  archive?: unknown;
  actionRequestId?: string;
  actorName?: string;
  action?: string;
  actorEmail: string;
}) {
  const db = getDb();
  const patch = {
    ...(input.title === undefined ? {} : { title: input.title.trim() }),
    ...(input.status === undefined ? {} : { status: normalizeRoleStatus(input.status) }),
    ...(input.code === undefined ? {} : { code: input.code?.trim() || null }),
    ...(input.departmentSnapshot === undefined ? {} : { departmentSnapshot: input.departmentSnapshot }),
    ...(input.requestType === undefined ? {} : { requestType: normalizeRequestType(input.requestType) }),
    ...(input.vacancies === undefined ? {} : { vacancies: Math.max(1, Math.trunc(input.vacancies)) }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.targetHiringDate === undefined ? {} : { targetHiringDate: input.targetHiringDate }),
    ...(input.recruitmentSetupStatus === undefined ? {} : { recruitmentSetupStatus: normalizeRecruitmentSetupStatus(input.recruitmentSetupStatus) }),
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
    ...(input.archive === undefined ? {} : { archive: input.archive as object }),
    updatedByEmail: input.actorEmail,
    updatedAt: new Date(),
  };
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ id: roles.id, status: roles.status, organizationId: roles.organizationId }).from(roles).where(eq(roles.externalId, input.externalId.trim())).limit(1);
    if (!current) return null;
    const [role] = await tx.update(roles).set(patch).where(eq(roles.id, current.id)).returning();
    const normalizedStatus = input.status === undefined ? undefined : normalizeRoleStatus(input.status);
    if (role && normalizedStatus && current.status !== normalizedStatus && input.actionRequestId) {
      await tx.insert(roleStatusHistory).values({
        organizationId: current.organizationId,
        roleId: current.id,
        previousStatus: current.status,
        newStatus: normalizedStatus,
        comments: input.latestComments || "",
        action: input.action || "role_updated",
        actionSource: "portal_postgres_target",
        actionRequestId: input.actionRequestId,
        changedByEmail: input.actorEmail,
        changedByName: input.actorName || "",
        notificationStatus: normalizedStatus === "job_posted" ? "pending" : "",
      }).onConflictDoNothing({ target: roleStatusHistory.actionRequestId });
    }
    return role ?? null;
  });
}

/** Target-mode role deletion is a reversible archive, never a hard delete. */
export async function archiveRole(input: { externalId: string; actorEmail: string; actorName?: string; actionRequestId: string }) {
  return updateRoleDetails({
    externalId: input.externalId,
    latestComments: "Role archived by portal operator",
    archive: { archivedAt: new Date().toISOString(), archivedBy: input.actorEmail, reason: "deleted_from_portal" },
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
  const [applicant] = await db.insert(applicants).values({ organizationId: DEFAULT_ORGANIZATION_ID, primaryEmail: email, fullName: input.fullName || "", phoneE164: input.phoneE164 || "", country: input.country || "", notes: input.notes || "" }).onConflictDoUpdate({ target: applicants.primaryEmail, set: { fullName: input.fullName || "", phoneE164: input.phoneE164 || "", country: input.country || "", notes: input.notes || "", updatedAt: new Date() } }).returning();
  return applicant;
}

export async function listApplications(stage?: string, roleExternalId?: string) {
  const db = getDb();
  const stageWhere = stage ? eq(applications.currentStage, stage) : undefined;
  const query = db.select({ application: applications, roleExternalId: roles.externalId, roleTitle: roles.title, departmentSnapshot: roles.departmentSnapshot, applicantEmail: applicants.primaryEmail, screeningResult: screeningResults, resumeFile: resumeFiles })
    .from(applications)
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .innerJoin(applicants, eq(applicants.id, applications.applicantId))
    .leftJoin(screeningResults, eq(screeningResults.applicationId, applications.id))
    .leftJoin(resumeFiles, eq(resumeFiles.id, applications.resumeFileId));
  return (roleExternalId ? query.where(and(stageWhere, eq(roles.externalId, roleExternalId))) : query.where(stageWhere))
    .orderBy(desc(applications.updatedAt)).limit(LIMIT);
}

/** Return only the newest target applicants needed by the notification bell. */
export async function listRecentApplications(department?: string, limit = 50) {
  const db = getDb();
  const query = db.select({ application: applications, roleExternalId: roles.externalId, roleTitle: roles.title, departmentSnapshot: roles.departmentSnapshot, applicantEmail: applicants.primaryEmail, screeningResult: screeningResults, resumeFile: resumeFiles })
    .from(applications)
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .innerJoin(applicants, eq(applicants.id, applications.applicantId))
    .leftJoin(screeningResults, eq(screeningResults.applicationId, applications.id))
    .leftJoin(resumeFiles, eq(resumeFiles.id, applications.resumeFileId));
  const departmentWhere = department?.trim()
    ? sql`lower(trim(${roles.departmentSnapshot})) = lower(trim(${department.trim()}))`
    : undefined;
  return query.where(departmentWhere).orderBy(desc(applications.appliedAt)).limit(Math.max(1, Math.min(LIMIT, Math.trunc(limit))));
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

export async function createApplication(input: { externalId: string; applicantEmail: string; applicantName?: string; phone?: string; preferredMobile?: string; applicantCountry?: string; roleExternalId: string; source?: string; sourceDetail?: string; consentAt?: string; resumeFileId?: string; creditOwnerEmail?: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [role] = await tx.select({ id: roles.id, organizationId: roles.organizationId, departmentSnapshot: roles.departmentSnapshot, requesterEmail: roles.requesterEmail }).from(roles).where(eq(roles.externalId, input.roleExternalId)).limit(1);
    if (!role) return { application: null, created: false, error: "unknown_role" as const };
    const email = input.applicantEmail.trim().toLowerCase();
    const [existingApplicant] = await tx.select({ id: applicants.id, organizationId: applicants.organizationId, fullName: applicants.fullName }).from(applicants).where(eq(applicants.primaryEmail, email)).limit(1);
    if (existingApplicant && existingApplicant.organizationId !== role.organizationId) {
      return { application: null, created: false, error: "applicant_belongs_to_another_organization" as const };
    }
    const [applicant] = existingApplicant
      ? await tx.update(applicants).set({ fullName: input.applicantName || "", phoneE164: input.phone || "", country: input.applicantCountry || "", updatedAt: new Date() }).where(eq(applicants.id, existingApplicant.id)).returning()
      : await tx.insert(applicants).values({ organizationId: role.organizationId, primaryEmail: email, fullName: input.applicantName || "", phoneE164: input.phone || "", country: input.applicantCountry || "" }).returning();
    const [application] = await tx.insert(applications).values({ organizationId: role.organizationId, externalId: input.externalId.trim(), applicantId: applicant.id, roleId: role.id, source: input.source || "direct", sourceDetail: input.sourceDetail || "", consentAt: isoOrNull(input.consentAt), departmentSnapshot: role.departmentSnapshot, candidateName: input.applicantName || applicant.fullName, email, phone: input.phone || "", preferredMobile: input.preferredMobile || "", applicantCountry: input.applicantCountry || "", resumeFileId: input.resumeFileId || null, creditOwnerEmail: (input.creditOwnerEmail || role.requesterEmail || "").trim().toLowerCase() }).onConflictDoNothing({ target: applications.externalId }).returning();
    if (!application) {
      const [existing] = await tx.select().from(applications).where(eq(applications.externalId, input.externalId.trim())).limit(1);
      return { application: existing ?? null, created: false, error: null };
    }
    await tx.insert(applicationStatusHistory).values({
      organizationId: application.organizationId,
      applicationId: application.id,
      stage: "application_received",
      previousStage: "",
      newStage: application.currentStage,
      source: "target:application",
      actionRequestId: `email:application_acknowledgment:${application.externalId}`,
      notificationStatus: "pending",
      notificationEventType: "application_acknowledgment",
      notificationRecipient: pilotEmailRecipient(email).to,
      notificationIntendedRecipient: email,
    }).onConflictDoNothing({ target: applicationStatusHistory.actionRequestId });
    return { application, created: true, error: null };
  });
}

export async function registerResumeFile(input: { storageRef: string; sha256: string; filename: string; mimeType: string; size: number; kind: string; expiresAt?: string; extractedText?: string; candidateName?: string; candidateEmail?: string; preferredMobile?: string; applicantCountry?: string; organizationId?: string }) {
  const db = getDb();
  const organizationId = input.organizationId?.trim() || DEFAULT_ORGANIZATION_ID;
  const extractedText = input.extractedText || "";
  const [row] = await db.insert(resumeFiles).values({ organizationId, storageRef: input.storageRef, sha256: input.sha256, filename: input.filename, mimeType: input.mimeType, size: input.size, kind: input.kind, textExtracted: Boolean(extractedText), extractedText, candidateName: input.candidateName || "", candidateEmail: input.candidateEmail || "", preferredMobile: input.preferredMobile || "", applicantCountry: input.applicantCountry || "", expiresAt: isoOrNull(input.expiresAt) }).onConflictDoNothing({ target: resumeFiles.storageRef }).returning({ id: resumeFiles.id });
  if (row) return row.id;
  const [existing] = await db.select({ id: resumeFiles.id, organizationId: resumeFiles.organizationId }).from(resumeFiles).where(eq(resumeFiles.storageRef, input.storageRef)).limit(1);
  if (existing && existing.organizationId !== organizationId) throw new Error("resume_storage_ref_belongs_to_another_organization");
  if (existing && extractedText) {
    await db.update(resumeFiles).set({ textExtracted: true, extractedText, candidateName: input.candidateName || "", candidateEmail: input.candidateEmail || "", preferredMobile: input.preferredMobile || "", applicantCountry: input.applicantCountry || "" }).where(eq(resumeFiles.id, existing.id));
  }
  return existing?.id || null;
}

/** Reuse a completed role-scoped screening for a duplicate application. */
export async function copyScreeningResult(input: { sourceApplicationId: string; targetApplicationId: string }) {
  if (input.sourceApplicationId === input.targetApplicationId) return false;
  const db = getDb();
  return db.transaction(async (tx) => {
    const [source] = await tx.select().from(screeningResults).where(eq(screeningResults.applicationId, input.sourceApplicationId)).limit(1);
    if (!source) return false;
    const [copied] = await tx.insert(screeningResults).values({
      organizationId: source.organizationId,
      applicationId: input.targetApplicationId,
      matchScore: source.matchScore,
      recommendation: source.recommendation,
      summary: source.summary,
      strengths: source.strengths,
      gaps: source.gaps,
      interviewQuestions: source.interviewQuestions,
      evaluationScores: source.evaluationScores as object,
      screenedAt: source.screenedAt,
      raw: source.raw as object | null,
    }).onConflictDoNothing({ target: screeningResults.applicationId }).returning({ id: screeningResults.id });
    return Boolean(copied);
  });
}

export async function getApplication(externalId: string) {
  const db = getDb();
  const [row] = await db.select({ application: applications, roleExternalId: roles.externalId, roleTitle: roles.title, roleTargetHiringDate: roles.targetHiringDate, roleHrCalendarEmail: roles.hrCalendarEmail, roleSetup: roles.setup, departmentSnapshot: roles.departmentSnapshot, applicantEmail: applicants.primaryEmail, screeningResult: screeningResults, resumeFile: resumeFiles }).from(applications).innerJoin(roles, eq(roles.id, applications.roleId)).innerJoin(applicants, eq(applicants.id, applications.applicantId)).leftJoin(screeningResults, eq(screeningResults.applicationId, applications.id)).leftJoin(resumeFiles, eq(resumeFiles.id, applications.resumeFileId)).where(eq(applications.externalId, externalId)).limit(1);
  return row ?? null;
}

export type AvatarInterviewContext = {
  applicationId: string;
  candidateName: string;
  roleId: string;
  roleTitle: string;
  roleDescription: string;
  resumeSummary: string;
  screeningQuestion: string;
  expiresAt: string;
  tokenStatus: string;
};

function firstInterviewQuestion(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw
    .split(/\r?\n/)
    .flatMap((line) => line.split(/\?\s+/).map((part, index, parts) => index < parts.length - 1 ? `${part}?` : part))
    .map((part) => part.replace(/^[-*\d.)\s]+/, "").trim())
    .find((part) => part.length >= 12) || "";
}

async function avatarInterviewContextByHash(tokenHash: string, allowedStatuses: string[]) {
  const db = getDb();
  const [row] = await db.select({
    token: bookingTokens,
    application: applications,
    roleExternalId: roles.externalId,
    roleTitle: roles.title,
    roleSetup: roles.setup,
    screeningResult: screeningResults,
  }).from(bookingTokens)
    .innerJoin(applications, eq(applications.id, bookingTokens.applicationId))
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .leftJoin(screeningResults, eq(screeningResults.applicationId, applications.id))
    .where(and(eq(bookingTokens.tokenHash, tokenHash), eq(bookingTokens.kind, "avatar"), inArray(bookingTokens.status, allowedStatuses)))
    .limit(1);
  if (!row) return null;
  if (row.token.expiresAt && row.token.expiresAt.getTime() <= Date.now()) return null;
  if (!["resume_approved", "voice_booking_pending"].includes(row.application.currentStage)) return null;
  const roleSetup = row.roleSetup && typeof row.roleSetup === "object" ? row.roleSetup as Record<string, unknown> : {};
  const screening = row.screeningResult as Record<string, unknown> | null;
  const screeningQuestion = firstInterviewQuestion(screening?.interviewQuestions)
    || String(roleSetup.requiredInterviewQuestion1 || "").trim()
    || "Please tell us about the experience that best prepares you for this role and the outcome you achieved.";
  return {
    applicationId: row.application.externalId,
    candidateName: row.application.candidateName,
    roleId: row.roleExternalId,
    roleTitle: row.roleTitle,
    roleDescription: String(roleSetup.jobDescription || "").trim(),
    resumeSummary: String(screening?.summary || screening?.strengths || "").trim(),
    screeningQuestion,
    expiresAt: row.token.expiresAt?.toISOString() || "",
    tokenStatus: row.token.status,
  } satisfies AvatarInterviewContext;
}

export async function getAvatarInterviewContext(rawToken: string, options: { allowActive?: boolean } = {}) {
  const tokenHash = crypto.createHash("sha256").update(rawToken.trim()).digest("hex");
  return avatarInterviewContextByHash(tokenHash, options.allowActive ? ["active"] : ["pending"]);
}

/** Atomically claims the candidate's one-time avatar link before starting a session. */
export async function startAvatarInterview(rawToken: string) {
  const db = getDb();
  const tokenHash = crypto.createHash("sha256").update(rawToken.trim()).digest("hex");
  const [claimed] = await db.update(bookingTokens).set({ status: "active" }).where(and(
    eq(bookingTokens.tokenHash, tokenHash),
    eq(bookingTokens.kind, "avatar"),
    eq(bookingTokens.status, "pending"),
    or(isNull(bookingTokens.expiresAt), gte(bookingTokens.expiresAt, new Date())),
  )).returning({ applicationId: bookingTokens.applicationId });
  if (!claimed) return null;
  // Choosing Ella is the candidate's alternative to scheduling the call.
  // Disable the unused phone-call link once the avatar interview starts.
  await db.update(bookingTokens).set({ status: "revoked" }).where(and(
    eq(bookingTokens.applicationId, claimed.applicationId),
    eq(bookingTokens.kind, "voice"),
    inArray(bookingTokens.status, ["pending", "active"]),
  ));
  return avatarInterviewContextByHash(tokenHash, ["active"]);
}

export async function completeAvatarInterview(input: { rawToken: string; sessionId: string; evaluation: LiveAvatarEvaluation; transcript: LiveAvatarTranscriptTurn[] }) {
  const db = getDb();
  const tokenHash = crypto.createHash("sha256").update(input.rawToken.trim()).digest("hex");
  const transcript = input.transcript.map((turn) => `${String(turn.role || "unknown")}: ${String(turn.transcript || "").trim()}`).filter((line) => !line.endsWith(": ")).join("\n");
  return db.transaction(async (tx) => {
    const [token] = await tx.select({ id: bookingTokens.id, applicationId: bookingTokens.applicationId, organizationId: bookingTokens.organizationId }).from(bookingTokens).where(and(eq(bookingTokens.tokenHash, tokenHash), eq(bookingTokens.kind, "avatar"), eq(bookingTokens.status, "active"))).for("update").limit(1);
    if (!token) return { completed: false, error: "avatar_link_already_used" as const };
    const now = new Date();
    await tx.insert(voiceInterviewResults).values({
      organizationId: token.organizationId,
      applicationId: token.applicationId,
      attemptId: null,
      score: input.evaluation.score,
      recommendation: input.evaluation.recommendation,
      strengths: input.evaluation.strengths.join("; "),
      concerns: input.evaluation.focusAreas.join("; "),
      summary: input.evaluation.summary,
      transcript,
      evaluationScores: input.evaluation as unknown as object,
      callStatus: "completed",
      callFinalStatus: "completed",
      providerEventType: "live_avatar_interview",
      resultReceivedAt: now,
      callCompletedAt: now,
      raw: { sessionId: input.sessionId, source: "live_avatar" },
    });
    await tx.update(bookingTokens).set({ status: "used", usedAt: now }).where(eq(bookingTokens.id, token.id));
    const [application] = await tx.update(applications).set({ currentStage: "voice_review_pending", updatedAt: now }).where(eq(applications.id, token.applicationId)).returning({ externalId: applications.externalId, currentStage: applications.currentStage });
    await tx.insert(applicationStatusHistory).values({
      organizationId: token.organizationId,
      applicationId: token.applicationId,
      stage: "voice",
      previousStage: "voice_booking_pending",
      newStage: "voice_review_pending",
      decision: "",
      source: "live_avatar",
      actionRequestId: `live-avatar:${tokenHash}`,
      notificationStatus: "",
      notificationEventType: "",
      notificationRecipient: "",
      notificationIntendedRecipient: "",
    }).onConflictDoNothing({ target: applicationStatusHistory.actionRequestId });
    return { completed: true, error: null, applicationId: application?.externalId || "" } as const;
  });
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

/**
 * Remove one application and its dependent workflow records atomically.
 * Application IDs are the portal's public identity; the person row is only
 * removed when it no longer has another application.
 */
export async function deleteApplication(externalId: string) {
  const db = getDb();
  const cleanExternalId = externalId.trim();
  if (!cleanExternalId) return { deleted: false, error: "invalid_application" as const };

  return db.transaction(async (tx) => {
    const [current] = await tx.select({ id: applications.id, applicantId: applications.applicantId })
      .from(applications)
      .where(eq(applications.externalId, cleanExternalId))
      .for("update")
      .limit(1);
    if (!current) return { deleted: false, error: "unknown_application" as const };

    // Only block deletion while a call is genuinely on the line. A merely
    // scheduled, queued, or retry-pending attempt has no live provider call
    // and is safe to remove with the rest of the record — the cascade below
    // deletes the attempt so no call is ever placed.
    const liveCallStatuses = ["calling", "dispatching", "initiated", "in_progress"];
    const liveCall = await tx.select({ id: voiceCallAttempts.id })
      .from(voiceCallAttempts)
      .where(and(eq(voiceCallAttempts.applicationId, current.id), inArray(voiceCallAttempts.status, liveCallStatuses)))
      .limit(1);
    if (liveCall.length > 0) return { deleted: false, error: "voice_interview_in_progress" as const };

    // Delete children first because the recruitment migration deliberately
    // keeps foreign keys restrictive instead of silently cascading workflow
    // history and calendar data.
    await tx.delete(voiceCallLogs).where(eq(voiceCallLogs.applicationId, current.id));
    await tx.delete(voiceInterviewResults).where(eq(voiceInterviewResults.applicationId, current.id));
    await tx.delete(voiceCallAttempts).where(eq(voiceCallAttempts.applicationId, current.id));
    await tx.delete(screeningResults).where(eq(screeningResults.applicationId, current.id));
    await tx.delete(screeningInvitations).where(eq(screeningInvitations.applicationId, current.id));
    await tx.delete(bulkScreeningQueueItems).where(eq(bulkScreeningQueueItems.applicationId, current.id));
    await tx.delete(interviewSlots).where(eq(interviewSlots.applicationId, current.id));
    await tx.delete(bookingTokens).where(eq(bookingTokens.applicationId, current.id));
    await tx.delete(applicationStatusHistory).where(eq(applicationStatusHistory.applicationId, current.id));
    await tx.delete(applications).where(eq(applications.id, current.id));

    const remaining = await tx.select({ id: applications.id })
      .from(applications)
      .where(eq(applications.applicantId, current.applicantId))
      .limit(1);
    if (remaining.length === 0) {
      await tx.delete(applicantAliases).where(eq(applicantAliases.applicantId, current.applicantId));
      await tx.delete(applicants).where(eq(applicants.id, current.applicantId));
    }
    return { deleted: true, error: null } as const;
  });
}

export async function markInterviewNoShow(slotId: string, actorEmail = "", actorName = "") {
  const db = getDb();
  const cleanSlotId = slotId.trim();
  if (!cleanSlotId) return { updated: false, error: "invalid_slot" as const };

  return db.transaction(async (tx) => {
    const [slot] = await tx.select({
      id: interviewSlots.id,
      status: interviewSlots.status,
      interviewType: interviewSlots.interviewType,
      startsAt: interviewSlots.startsAt,
      applicationId: interviewSlots.applicationId,
    }).from(interviewSlots).where(eq(interviewSlots.id, cleanSlotId)).for("update").limit(1);
    if (!slot) return { updated: false, error: "unknown_slot" as const };
    if (slot.status !== "booked") return { updated: false, error: "slot_not_booked" as const };
    if (slot.startsAt.getTime() > Date.now()) return { updated: false, error: "slot_not_started" as const };

    await tx.update(interviewSlots).set({ status: "no_show", updatedAt: new Date() }).where(eq(interviewSlots.id, slot.id));
    if (!slot.applicationId) return { updated: true, applicationId: "", status: "No Show" } as const;

    const [application] = await tx.select({ id: applications.id, organizationId: applications.organizationId, currentStage: applications.currentStage })
      .from(applications).where(eq(applications.id, slot.applicationId)).for("update").limit(1);
    if (!application) return { updated: true, applicationId: "", status: "No Show" } as const;
    const nextStage = slot.interviewType === "voice" && application.currentStage === "voice_scheduled"
      ? "voice_review_pending"
      : slot.interviewType === "final" && application.currentStage === "final_scheduled"
        ? "final_decision_pending"
        : application.currentStage;
    if (nextStage !== application.currentStage) {
      await tx.update(applications).set({ currentStage: nextStage, updatedAt: new Date() }).where(eq(applications.id, application.id));
      await tx.insert(applicationStatusHistory).values({
        organizationId: application.organizationId,
        applicationId: application.id,
        stage: slot.interviewType === "voice" ? "voice" : "final",
        previousStage: application.currentStage,
        newStage: nextStage,
        decision: "no_show",
        actorName,
        actorEmail,
        comments: `${slot.interviewType === "voice" ? "Voice" : "Face-to-face"} interview marked No Show.`,
        source: "portal:no_show",
        actionRequestId: `portal:no_show:${slot.id}`,
        notificationStatus: "pending",
        notificationEventType: "application_stage_update",
      }).onConflictDoNothing({ target: applicationStatusHistory.actionRequestId });
    }
    const [external] = await tx.select({ externalId: applications.externalId }).from(applications).where(eq(applications.id, application.id)).limit(1);
    return { updated: true, applicationId: external?.externalId || "", status: "No Show" } as const;
  });
}

export async function upsertScreeningResult(input: { applicationExternalId: string; matchScore?: number | null; recommendation?: string; summary?: string; strengths?: string; gaps?: string; interviewQuestions?: string; evaluationScores?: unknown; screenedAt?: string; raw?: unknown }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [application] = await tx.select({ id: applications.id, organizationId: applications.organizationId, email: applications.email }).from(applications).where(eq(applications.externalId, input.applicationExternalId)).limit(1);
    if (!application) return { result: null, error: "unknown_application" as const };
    const [existing] = await tx.select({ matchScore: screeningResults.matchScore }).from(screeningResults).where(eq(screeningResults.applicationId, application.id)).limit(1);
    // A partial or retried callback must never erase a previously persisted
    // grade just because its score was omitted or encoded as an empty value.
    const resultValues = { matchScore: input.matchScore ?? existing?.matchScore ?? null, recommendation: input.recommendation || "", summary: input.summary || "", strengths: input.strengths || "", gaps: input.gaps || "", interviewQuestions: input.interviewQuestions || "", evaluationScores: (input.evaluationScores ?? []) as object, screenedAt: isoOrNull(input.screenedAt), raw: (input.raw ?? null) as object | null };
    const [result] = await tx.insert(screeningResults).values({ organizationId: application.organizationId, applicationId: application.id, ...resultValues }).onConflictDoUpdate({ target: screeningResults.applicationId, set: resultValues }).returning();
    await tx.insert(applicationStatusHistory).values({
      organizationId: application.organizationId,
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
      notificationRecipient: pilotEmailRecipient(application.email).to,
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

/** Batch screening evidence lookup for the bulk status endpoint. */
export async function listScreeningForApplications(applicationExternalIds: string[]) {
  const ids = [...new Set(applicationExternalIds.map((value) => value.trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  const db = getDb();
  return db.select({ result: screeningResults, applicationExternalId: applications.externalId })
    .from(screeningResults)
    .innerJoin(applications, eq(applications.id, screeningResults.applicationId))
    .where(inArray(applications.externalId, ids))
    .orderBy(desc(screeningResults.createdAt))
    .limit(LIMIT);
}

export async function createScreeningInvitation(input: { roleExternalId: string; tokenHash: string; email: string; createdBy: string; expiresAt?: string }) {
  const db = getDb();
  const [role] = await db.select({ id: roles.id, organizationId: roles.organizationId }).from(roles).where(eq(roles.externalId, input.roleExternalId)).limit(1);
  if (!role) return { invitation: null, created: false, error: "unknown_role" as const };
  const [invitation] = await db.insert(screeningInvitations).values({ organizationId: role.organizationId, roleId: role.id, tokenHash: input.tokenHash, email: input.email.trim().toLowerCase(), createdBy: input.createdBy, expiresAt: isoOrNull(input.expiresAt) }).onConflictDoNothing({ target: screeningInvitations.tokenHash }).returning();
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
  return db.transaction(async (tx) => {
    // Do this in the same transaction as the claim. A data-modifying CTE and
    // its sibling SELECT share a snapshot, so putting expiry in one statement
    // could leave an expired row visible to the claim query.
    await tx.execute(sql`UPDATE voice_call_attempts SET status = 'failed', outcome = 'system_failure', updated_at = now() WHERE status IN ('scheduled','queued','retry_scheduled') AND scheduled_at < now() - (${VOICE_CALL_MAX_LATE_MINUTES} * interval '1 minute')`);
    const result = await tx.execute(sql`WITH claimed AS (SELECT id FROM voice_call_attempts WHERE status IN ('scheduled','queued','retry_scheduled') AND (scheduled_at IS NULL OR scheduled_at <= now()) ORDER BY scheduled_at NULLS FIRST, created_at FOR UPDATE SKIP LOCKED LIMIT ${safeLimit}) UPDATE voice_call_attempts v SET status = 'calling', updated_at = now() FROM claimed c WHERE v.id = c.id RETURNING v.id, v.application_id AS "applicationId", v.attempt_number AS "attemptNumber", v.max_attempts AS "maxAttempts", v.status, v.scheduled_at AS "scheduledAt"`);
    return rowsOf<Record<string, unknown>>(result);
  });
}

export async function pendingVoiceCalls() {
  const db = getDb();
  await db.execute(sql`UPDATE voice_call_attempts SET status = 'failed', outcome = 'system_failure', updated_at = now() WHERE status IN ('scheduled','queued','retry_scheduled') AND scheduled_at < now() - (${VOICE_CALL_MAX_LATE_MINUTES} * interval '1 minute')`);
  return db.select({ id: voiceCallAttempts.id, applicationId: voiceCallAttempts.applicationId, externalId: applications.externalId, candidateName: applications.candidateName, email: applications.email, preferredMobile: voiceCallAttempts.preferredMobile, contactNumber: voiceCallAttempts.contactNumber, applicantCountry: voiceCallAttempts.applicantCountry, attemptNumber: voiceCallAttempts.attemptNumber, maxAttempts: voiceCallAttempts.maxAttempts, scheduledAt: voiceCallAttempts.scheduledAt, status: voiceCallAttempts.status }).from(voiceCallAttempts).innerJoin(applications, eq(applications.id, voiceCallAttempts.applicationId)).where(and(inArray(voiceCallAttempts.status, ["scheduled", "queued", "retry_scheduled"]), or(isNull(voiceCallAttempts.scheduledAt), and(lte(voiceCallAttempts.scheduledAt, sql`now()`), gte(voiceCallAttempts.scheduledAt, sql`now() - (${VOICE_CALL_MAX_LATE_MINUTES} * interval '1 minute')`))))).orderBy(asc(voiceCallAttempts.scheduledAt)).limit(LIMIT);
}

export async function dispatchVoiceAttemptDryRun(input: { attemptId: string; providerCallId: string }) {
  const db = getDb();
  const result = await db.execute(sql`UPDATE voice_call_attempts SET status = 'initiated', provider_call_id = ${input.providerCallId}, updated_at = now() WHERE id = ${input.attemptId} AND status = 'calling' RETURNING id, application_id AS "applicationId", provider_call_id AS "providerCallId", status`);
  return rowsOf<Record<string, unknown>>(result)[0] || null;
}

/** Claim the provider side-effect before making the outbound request. */
export async function beginVoiceAttemptDispatch(attemptId: string) {
  const db = getDb();
  const result = await db.execute(sql`UPDATE voice_call_attempts SET status = 'dispatching', updated_at = now() WHERE id = ${attemptId.trim()} AND status = 'calling' RETURNING id, application_id AS "applicationId", attempt_number AS "attemptNumber", scheduled_at AS "scheduledAt"`);
  return rowsOf<Record<string, unknown>>(result)[0] || null;
}

export async function recordVoiceAttemptProviderCall(input: { attemptId: string; providerCallId: string }) {
  const db = getDb();
  const result = await db.execute(sql`UPDATE voice_call_attempts SET status = 'initiated', provider_call_id = ${input.providerCallId.trim()}, updated_at = now() WHERE id = ${input.attemptId.trim()} AND status = 'dispatching' RETURNING id, provider_call_id AS "providerCallId", status`);
  return rowsOf<Record<string, unknown>>(result)[0] || null;
}

export async function failVoiceAttemptDispatch(attemptId: string, reason: string) {
  const db = getDb();
  const result = await db.execute(sql`UPDATE voice_call_attempts SET status = 'failed', outcome = 'system_failure', updated_at = now() WHERE id = ${attemptId.trim()} AND status = 'dispatching' RETURNING id, status, outcome`);
  if (rowsOf(result).length > 0) {
    await createVoiceCallLog({
      applicationExternalId: (await voiceAttemptContext(attemptId))?.applicationExternalId || "",
      voiceCallAttemptId: attemptId,
      provider: "vapi",
      sourceEventKey: `dispatch-failed:${attemptId}`,
      callStatus: "failed",
      errorDetails: reason,
      rawResult: { dispatchFailed: true },
      allowTerminalAttempt: true,
    }).catch(() => undefined);
  }
  return rowsOf<Record<string, unknown>>(result)[0] || null;
}

/** Terminally block a claimed attempt when a pre-call safety check fails. */
export async function blockVoiceAttempt(attemptId: string, reason: string) {
  const db = getDb();
  const result = await db.execute(sql`UPDATE voice_call_attempts SET status = 'failed', outcome = 'system_failure', updated_at = now() WHERE id = ${attemptId.trim()} AND status = 'calling' RETURNING id, application_id AS "applicationId"`);
  const row = rowsOf<Record<string, unknown>>(result)[0];
  if (row) {
    const context = await voiceAttemptContext(attemptId);
    if (context) await createVoiceCallLog({ applicationExternalId: context.applicationExternalId, voiceCallAttemptId: attemptId, provider: "vapi", sourceEventKey: `dispatch-blocked:${attemptId}`, callStatus: "blocked", errorDetails: reason, rawResult: { dispatchBlocked: true }, allowTerminalAttempt: true }).catch(() => undefined);
  }
  return row || null;
}

export async function voiceAttemptContext(attemptId: string) {
  const db = getDb();
  const [row] = await db.select({
    attempt: voiceCallAttempts,
    applicationExternalId: applications.externalId,
    candidateName: applications.candidateName,
    candidateEmail: applications.email,
    creditOwnerEmail: applications.creditOwnerEmail,
    organizationId: applications.organizationId,
    phone: applications.phone,
    preferredMobile: applications.preferredMobile,
    applicantCountry: applications.applicantCountry,
    applicantPhone: applicants.phoneE164,
    currentStage: applications.currentStage,
    withdrawn: applications.withdrawn,
    roleExternalId: roles.externalId,
    roleTitle: roles.title,
  }).from(voiceCallAttempts)
    .innerJoin(applications, eq(applications.id, voiceCallAttempts.applicationId))
    .innerJoin(applicants, eq(applicants.id, applications.applicantId))
    .leftJoin(roles, eq(roles.id, voiceCallAttempts.roleId))
    .where(eq(voiceCallAttempts.id, attemptId.trim()))
    .limit(1);
  return row ?? null;
}

export async function updateVoiceAttemptStatus(input: { attemptId: string; status: string; outcome?: string; providerCallId?: string; retryAfter?: string; reason?: string }) {
  if (!Object.prototype.hasOwnProperty.call(VOICE_STATUS_TRANSITIONS, input.status)) return { updated: false, error: "invalid_status" as const };
  const db = getDb();
  const previousStatuses = Object.entries(VOICE_STATUS_TRANSITIONS).filter(([, next]) => next.includes(input.status)).map(([status]) => status);
  const allowedWhere = previousStatuses.length > 0 ? sql`status IN (${sql.join(previousStatuses.map((status) => sql`${status}`), sql`, `)})` : sql`false`;
  const result = await db.execute(sql`UPDATE voice_call_attempts SET status = ${input.status}, outcome = ${input.outcome || null}, provider_call_id = COALESCE(NULLIF(${input.providerCallId || ""}, ''), provider_call_id), retry_after = ${isoOrNull(input.retryAfter)}, updated_at = now() WHERE id = ${input.attemptId} AND (status = ${input.status} OR ${allowedWhere}) RETURNING id`);
  const updated = rowsOf(result).length > 0;
  // The n8n dispatch worker calls Vapi itself and is the only place that ever
  // sees *why* a dispatch failed (a rejected phone number, a provider error,
  // ...). Without this, "failed"/"system_failure" reached the attempt with no
  // trace of the actual cause. allowTerminalAttempt is required: this call
  // updates the attempt to "failed" moments before logging it.
  if (updated && input.reason && (input.status === "failed" || input.status === "cancelled")) {
    const context = await voiceAttemptContext(input.attemptId);
    if (context) {
      await createVoiceCallLog({
        applicationExternalId: context.applicationExternalId,
        voiceCallAttemptId: input.attemptId,
        provider: "vapi",
        sourceEventKey: `attempt-status-${input.status}:${input.attemptId}`,
        callStatus: input.status,
        errorDetails: input.reason,
        rawResult: { attemptStatusReason: true, outcome: input.outcome || null },
        allowTerminalAttempt: true,
      }).catch(() => undefined);
    }
  }
  // A status update alone cannot prove a completed or incomplete interview;
  // those outcomes are billed from the terminal Vapi result/log. No-answer is
  // safe to settle here because it is itself the terminal call outcome.
  const classified = classifyVoiceInterviewBillingOutcome({ outcome: input.outcome, callStatus: input.status });
  const outcome = classified === "no_answer" ? classified : null;
  let chargedCredits = 0;
  if (outcome) {
    const context = await voiceAttemptContext(input.attemptId);
    if (context) chargedCredits = await recordVoiceInterviewDeduction({ applicationId: context.applicationExternalId, attemptId: input.attemptId, outcome, actorEmail: context.creditOwnerEmail, organizationId: context.organizationId });
  }
  return { updated, chargedCredits, billingOutcome: outcome, error: null };
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
    const [application] = await tx.select({ id: applications.id, organizationId: applications.organizationId, email: applications.email }).from(applications).where(eq(applications.id, current.applicationId)).limit(1);
    if (!application) return { scheduled: false, duplicate: false, terminal: false, error: "application_not_found" as const };
    await tx.insert(applicationStatusHistory).values({
      organizationId: application.organizationId,
      applicationId: current.applicationId,
      stage: "voice_no_show",
      previousStage: "voice_scheduled",
      newStage: "voice_no_show",
      source: "internal_api:voice_retry",
      actionRequestId: `email:voice_no_show:${current.id}`,
      notificationStatus: "pending",
      notificationEventType: "voice_no_show",
      notificationRecipient: pilotEmailRecipient(application.email).to,
      notificationIntendedRecipient: application.email,
    }).onConflictDoNothing({ target: applicationStatusHistory.actionRequestId });
    if (current.attemptNumber >= current.maxAttempts) return { scheduled: false, duplicate: false, terminal: true, error: null };
    const nextAttemptNumber = current.attemptNumber + 1;
    const [existing] = await tx.select({ id: voiceCallAttempts.id, status: voiceCallAttempts.status }).from(voiceCallAttempts).where(and(eq(voiceCallAttempts.applicationId, current.applicationId), eq(voiceCallAttempts.attemptNumber, nextAttemptNumber))).limit(1);
    if (existing) return { scheduled: false, duplicate: true, terminal: false, error: null };
    const [next] = await tx.insert(voiceCallAttempts).values({
      organizationId: current.organizationId,
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
        organizationId: application.organizationId,
        applicationId: current.applicationId,
        stage: "voice_retry",
        previousStage: "voice_no_show",
        newStage: "voice_retry",
        source: "internal_api:voice_retry",
        actionRequestId: `email:voice_retry:${next.id}`,
        notificationStatus: "pending",
        notificationEventType: "voice_retry",
        notificationRecipient: pilotEmailRecipient(application.email).to,
        notificationIntendedRecipient: application.email,
      }).onConflictDoNothing({ target: applicationStatusHistory.actionRequestId });
    }
    return { scheduled: Boolean(next), duplicate: false, terminal: false, error: null, next };
  });
}

export async function ingestVoiceResult(input: { applicationExternalId: string; attemptId?: string; score?: number | null; recommendation?: string; strengths?: string; concerns?: string; summary?: string; transcript?: string; callStatus?: string; callFinalStatus?: string; providerEventType?: string; callCompletedAt?: string; raw?: unknown; sourceEventKey?: string; isComplete?: boolean; completenessScore?: number | null }) {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [application] = await tx.select({ id: applications.id, organizationId: applications.organizationId, creditOwnerEmail: applications.creditOwnerEmail, email: applications.email }).from(applications).where(eq(applications.externalId, input.applicationExternalId)).for("update").limit(1);
    if (!application) return { inserted: false, applicationId: null, attemptId: null, candidateEmail: "", creditOwnerEmail: "", organizationId: DEFAULT_ORGANIZATION_ID, chargedCredits: 0, billingOutcome: null, error: "unknown_application" as const };
    const attempts = await tx.select({ id: voiceCallAttempts.id, status: voiceCallAttempts.status }).from(voiceCallAttempts).where(eq(voiceCallAttempts.applicationId, application.id)).orderBy(desc(voiceCallAttempts.attemptNumber), desc(voiceCallAttempts.createdAt));
    const attempt = input.attemptId ? attempts.find((item) => item.id === input.attemptId) : attempts[0];
    if (!attempt) return { inserted: false, applicationId: application.id, attemptId: null, candidateEmail: application.email, creditOwnerEmail: application.creditOwnerEmail, organizationId: application.organizationId, chargedCredits: 0, billingOutcome: null, error: "attempt_not_found" as const };
    if (attempt.id !== attempts[0]?.id) return { inserted: false, applicationId: application.id, attemptId: attempt.id, candidateEmail: application.email, creditOwnerEmail: application.creditOwnerEmail, organizationId: application.organizationId, chargedCredits: 0, billingOutcome: null, error: "stale_attempt" as const };
    if (["failed", "cancelled"].includes(attempt.status)) return { inserted: false, applicationId: application.id, attemptId: attempt.id, candidateEmail: application.email, creditOwnerEmail: application.creditOwnerEmail, organizationId: application.organizationId, chargedCredits: 0, billingOutcome: null, error: "attempt_not_processable" as const };
    const attemptId = attempt?.id || null;
    const completedAt = isoOrNull(input.callCompletedAt);
    const existing = await tx.select({ id: voiceInterviewResults.id }).from(voiceInterviewResults).where(and(eq(voiceInterviewResults.applicationId, application.id), eq(voiceInterviewResults.providerEventType, input.providerEventType || ""), completedAt ? eq(voiceInterviewResults.callCompletedAt, completedAt) : isNull(voiceInterviewResults.callCompletedAt))).limit(1);
    if (existing.length > 0) return { inserted: false, applicationId: application.id, attemptId, candidateEmail: application.email, creditOwnerEmail: application.creditOwnerEmail, organizationId: application.organizationId, chargedCredits: 0, billingOutcome: null, error: null };
    const [inserted] = await tx.insert(voiceInterviewResults).values({ organizationId: application.organizationId, applicationId: application.id, attemptId, score: input.score ?? null, recommendation: input.recommendation || "", strengths: input.strengths || "", concerns: input.concerns || "", summary: input.summary || "", transcript: input.transcript || "", callStatus: input.callStatus || "", callFinalStatus: input.callFinalStatus || "", providerEventType: input.providerEventType || "", callCompletedAt: completedAt, resultReceivedAt: new Date(), raw: (input.raw ?? null) as object | null }).returning();
    await tx.update(applications).set({ currentStage: "voice_review_pending", updatedAt: new Date() }).where(and(eq(applications.id, application.id), eq(applications.currentStage, "voice_scheduled")));
    await tx.insert(applicationStatusHistory).values({ organizationId: application.organizationId, applicationId: application.id, stage: "voice_review_pending", previousStage: "voice_scheduled", newStage: "voice_review_pending", decision: input.recommendation || "", source: "internal_api:voice_result", comments: input.summary || "", actionRequestId: input.sourceEventKey || null, notificationStatus: "pending", notificationEventType: "voice_result_next_step", notificationRecipient: pilotEmailRecipient(application.email).to, notificationIntendedRecipient: application.email }).onConflictDoNothing({ target: applicationStatusHistory.actionRequestId });
    return { inserted: Boolean(inserted), applicationId: application.id, attemptId, candidateEmail: application.email, creditOwnerEmail: application.creditOwnerEmail, organizationId: application.organizationId, chargedCredits: 0, billingOutcome: null, error: null };
  });
  if (!result.applicationId || !result.attemptId) return { ...result, chargedCredits: 0, billingOutcome: null };
  const billingOutcome = classifyVoiceInterviewBillingOutcome(input);
  const chargedCredits = billingOutcome ? await recordVoiceInterviewDeduction({ applicationId: input.applicationExternalId, attemptId: result.attemptId, outcome: billingOutcome, actorEmail: result.creditOwnerEmail, organizationId: result.organizationId }) : 0;
  return { ...result, chargedCredits, billingOutcome };
}

/** Latest voice-call artefacts for one application, for the HR review view. */
export async function applicationVoiceReview(externalId: string) {
  const db = getDb();
  const [application] = await db.select({ id: applications.id }).from(applications).where(eq(applications.externalId, externalId.trim())).limit(1);
  if (!application) return null;
  const [result] = await db.select().from(voiceInterviewResults).where(eq(voiceInterviewResults.applicationId, application.id)).orderBy(desc(voiceInterviewResults.createdAt)).limit(1);
  const [log] = await db.select().from(voiceCallLogs).where(eq(voiceCallLogs.applicationId, application.id)).orderBy(desc(voiceCallLogs.createdAt)).limit(1);
  const [attempt] = await db.select().from(voiceCallAttempts).where(eq(voiceCallAttempts.applicationId, application.id)).orderBy(desc(voiceCallAttempts.attemptNumber), desc(voiceCallAttempts.createdAt)).limit(1);
  return { result: result ?? null, log: log ?? null, attempt: attempt ?? null };
}

export async function voiceResultStatuses(applicationExternalIds: string[]) {
  const db = getDb();
  if (applicationExternalIds.length === 0) return [];
  return db.select({ externalId: applications.externalId, currentStage: applications.currentStage, voiceHrDecision: applications.voiceHrDecision, latestResultAt: sql<string>`max(${voiceInterviewResults.createdAt})` }).from(applications).leftJoin(voiceInterviewResults, eq(voiceInterviewResults.applicationId, applications.id)).where(inArray(applications.externalId, applicationExternalIds)).groupBy(applications.externalId, applications.currentStage, applications.voiceHrDecision);
}

export async function createVoiceCallLog(input: { applicationExternalId: string; voiceCallAttemptId?: string; provider?: string; providerCallId?: string; providerEventId?: string; sourceEventKey: string; callStatus?: string; durationSeconds?: number | null; recordingUrl?: string; communicationScore?: number | null; completenessScore?: number | null; transcript?: string; summary?: string; recommendation?: string; errorDetails?: string; rawResult?: unknown; startedAt?: string; endedAt?: string; isComplete?: boolean; allowTerminalAttempt?: boolean }) {
  const db = getDb();
  const [application] = await db.select({ id: applications.id, organizationId: applications.organizationId, creditOwnerEmail: applications.creditOwnerEmail, email: applications.email }).from(applications).where(eq(applications.externalId, input.applicationExternalId)).limit(1);
  if (!application) return { log: null, created: false, error: "unknown_application" as const };
  const attempts = await db.select({ id: voiceCallAttempts.id, status: voiceCallAttempts.status }).from(voiceCallAttempts).where(eq(voiceCallAttempts.applicationId, application.id)).orderBy(desc(voiceCallAttempts.attemptNumber), desc(voiceCallAttempts.createdAt));
  const attempt = input.voiceCallAttemptId ? attempts.find((item) => item.id === input.voiceCallAttemptId) : attempts[0];
  if (!attempt) return { log: null, created: false, error: "attempt_not_found" as const };
  if (attempt.id !== attempts[0]?.id) return { log: null, created: false, error: "stale_attempt" as const };
  // A dispatch-failure/blocked log call from failVoiceAttemptDispatch/blockVoiceAttempt
  // records the very reason the attempt just became "failed" moments ago — it must
  // not be rejected by the terminal-attempt guard below, or the error is lost forever
  // (see docs/VOICE-BILLING-OUTCOME-MAPPING.md incident history). Webhook/replay
  // callers never set this flag, so late results for an already-terminal attempt
  // are still rejected as before.
  if (!input.allowTerminalAttempt && ["failed", "cancelled"].includes(attempt.status)) return { log: null, created: false, error: "attempt_not_processable" as const };
  const [log] = await db.insert(voiceCallLogs).values({ organizationId: application.organizationId, applicationId: application.id, voiceCallAttemptId: attempt?.id || null, provider: input.provider || "", providerCallId: input.providerCallId || "", providerEventId: input.providerEventId || "", sourceEventKey: input.sourceEventKey, callStatus: input.callStatus || "", durationSeconds: input.durationSeconds ?? null, recordingUrl: input.recordingUrl || "", communicationScore: input.communicationScore ?? null, completenessScore: input.completenessScore ?? null, transcript: input.transcript || "", summary: input.summary || "", recommendation: input.recommendation || "", errorDetails: input.errorDetails || "", rawResult: (input.rawResult ?? null) as object | null, startedAt: isoOrNull(input.startedAt), endedAt: isoOrNull(input.endedAt) }).onConflictDoNothing({ target: voiceCallLogs.sourceEventKey }).returning();
  const billingOutcome = classifyVoiceInterviewBillingOutcome(input);
  const chargedCredits = billingOutcome && attempt ? await recordVoiceInterviewDeduction({ applicationId: input.applicationExternalId, attemptId: attempt.id, outcome: billingOutcome, actorEmail: application.creditOwnerEmail, organizationId: application.organizationId }) : 0;
  return { log: log ?? null, created: Boolean(log), chargedCredits, billingOutcome, error: null };
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
    if (input.stage === "resume" && input.decision === "approve") {
      const [screening] = await tx.select({ id: screeningResults.id }).from(screeningResults).where(eq(screeningResults.applicationId, current.id)).limit(1);
      if (!screening) return { updated: false, error: "screening_required" as const };
    }
    const [history] = await tx.select({ id: applicationStatusHistory.id }).from(applicationStatusHistory).where(eq(applicationStatusHistory.actionRequestId, input.actionRequestId)).limit(1);
    if (history) return { updated: false, duplicate: true, error: null };
    if (current.currentStage !== expectedStage) return { updated: false, error: "invalid_transition" as const };
    const patch = input.stage === "resume" ? { resumeHrDecision: input.decision, resumeHrDecisionAt: new Date(), resumeHrReviewer: input.actorEmail, resumeHrComments: input.comments || "" } : input.stage === "voice" ? { voiceHrDecision: input.decision, voiceHrComments: input.comments || "" } : { finalHrDecision: input.decision, finalInterviewComments: input.comments || "" };
    await tx.update(applications).set({ ...patch, currentStage: targetStage, updatedAt: new Date() }).where(eq(applications.id, current.id));
    const notificationEventType = input.stage === "voice" && input.decision === "reject" ? "voice_rejection" : input.stage === "final" && input.decision === "approve" ? "final_decision_pass" : input.stage === "final" && input.decision === "reject" ? "final_decision_reject" : "";
    await tx.insert(applicationStatusHistory).values({ organizationId: current.organizationId, applicationId: current.id, stage: input.stage, previousStage: current.currentStage, newStage: targetStage, decision: input.decision, actorEmail: input.actorEmail, actorName: input.actorName || "", comments: input.comments || "", source: "internal_api:hr_decision", actionRequestId: input.actionRequestId, notificationStatus: notificationEventType ? "pending" : "", notificationEventType, notificationRecipient: notificationEventType ? pilotEmailRecipient(current.email).to : "", notificationIntendedRecipient: notificationEventType ? current.email : "" });
    return { updated: true, duplicate: false, error: null };
  });
}

export async function listApplicationHistory(externalId?: string) {
  const db = getDb();
  const query = db.select({ history: applicationStatusHistory, externalId: applications.externalId }).from(applicationStatusHistory).innerJoin(applications, eq(applications.id, applicationStatusHistory.applicationId));
  return (externalId ? query.where(eq(applications.externalId, externalId)) : query).orderBy(desc(applicationStatusHistory.changedAt)).limit(LIMIT);
}

export async function getApplicationBookingNotification(externalId: string, kind: "voice" | "final") {
  const db = getDb();
  const eventType = kind === "voice" ? "voice_booking_invitation" : "final_booking_invitation";
  const [row] = await db.select({
    notificationStatus: applicationStatusHistory.notificationStatus,
    notificationSentAt: applicationStatusHistory.notificationSentAt,
    notificationError: applicationStatusHistory.notificationError,
  }).from(applicationStatusHistory)
    .innerJoin(applications, eq(applications.id, applicationStatusHistory.applicationId))
    .where(and(eq(applications.externalId, externalId.trim()), eq(applicationStatusHistory.notificationEventType, eventType)))
    .orderBy(desc(applicationStatusHistory.changedAt))
    .limit(1);
  return row ?? null;
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
    await tx.insert(applicationStatusHistory).values({ organizationId: current.organizationId, applicationId: current.id, stage: input.newStage, previousStage: current.currentStage, newStage: input.newStage, actorEmail: input.actorEmail || "", actorName: input.actorName || "", comments: input.comments || "", source: "internal_api:status", actionRequestId: input.actionRequestId });
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

/** Fast target duplicate check used before resume parsing/upload work. */
export async function findBulkQueueByRoleAndSha(roleExternalId: string, resumeSha256: string) {
  const db = getDb();
  const [row] = await db.select({ id: bulkScreeningQueueItems.id, status: bulkScreeningQueueItems.status })
    .from(bulkScreeningQueueItems)
    .innerJoin(roles, eq(roles.id, bulkScreeningQueueItems.roleId))
    .where(and(eq(roles.externalId, roleExternalId.trim()), eq(bulkScreeningQueueItems.resumeSha256, resumeSha256.trim().toLowerCase())))
    .limit(1);
  return row ?? null;
}

export async function enqueueBulkScreening(input: {
  roleExternalId: string;
  applicationExternalId?: string;
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
    const [role] = await tx.select({ id: roles.id, organizationId: roles.organizationId }).from(roles).where(eq(roles.externalId, input.roleExternalId.trim())).limit(1);
    if (!role) return { item: null, created: false, error: "unknown_role" as const };
    let applicationId: string | null = null;
    if (input.applicationExternalId) {
      const [application] = await tx.select({ id: applications.id, organizationId: applications.organizationId }).from(applications).where(eq(applications.externalId, input.applicationExternalId.trim())).limit(1);
      if (!application) return { item: null, created: false, error: "unknown_application" as const };
      if (application.organizationId !== role.organizationId) return { item: null, created: false, error: "application_belongs_to_another_organization" as const };
      applicationId = application.id;
    }
    const [item] = await tx.insert(bulkScreeningQueueItems).values({
      organizationId: role.organizationId, roleId: role.id, applicationId, batchId: input.batchId || "", dedupeKey: input.dedupeKey.trim(), resumeSha256: input.resumeSha256.trim().toLowerCase(),
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
      organizationId: application.organizationId,
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

    const credit = perUserCreditsEnabled()
      ? await appendAccountLedgerEntryOnExecutor(tx, { organizationId: application.organizationId, ownerEmail: application.creditOwnerEmail, entry: input.ledger }, { guard: true })
      : await appendPostgresLedgerEntryOnExecutor(tx, input.ledger, { guard: true });
    const actionRequestId = `screening:${input.dedupeKey.trim()}`;
    await tx.insert(applicationStatusHistory).values({
      organizationId: application.organizationId,
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
      notificationRecipient: pilotEmailRecipient(application.email).to,
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
  let organizationId = DEFAULT_ORGANIZATION_ID;
  if (input.roleExternalId) {
    const [role] = await db.select({ id: roles.id, organizationId: roles.organizationId }).from(roles).where(eq(roles.externalId, input.roleExternalId.trim())).limit(1);
    if (!role) return { slot: null, error: "unknown_role" as const };
    roleId = role.id;
    organizationId = role.organizationId;
  }
  const [slot] = await db.insert(interviewSlots).values({ organizationId, slotCode: input.slotCode?.trim() || null, interviewType: input.interviewType, roleId, startsAt, endsAt, timezone: input.timezone.trim(), status: "available" }).onConflictDoNothing({ target: interviewSlots.slotCode }).returning();
  if (slot) return { slot, created: true, error: null };
  const [existing] = input.slotCode ? await db.select().from(interviewSlots).where(eq(interviewSlots.slotCode, input.slotCode.trim())).limit(1) : [];
  return { slot: existing ?? null, created: false, error: null };
}

export async function bookInterviewSlot(input: { slotId: string; applicationExternalId: string; actorEmail: string; actionRequestId: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [application] = await tx.select({ id: applications.id, organizationId: applications.organizationId, applicantId: applications.applicantId, candidateName: applications.candidateName, email: applications.email, phone: applications.phone, preferredMobile: applications.preferredMobile }).from(applications).where(eq(applications.externalId, input.applicationExternalId)).limit(1);
    if (!application) return { booked: false, error: "unknown_application" as const };
    const [applicant] = await tx.select({ phoneE164: applicants.phoneE164 }).from(applicants).where(eq(applicants.id, application.applicantId)).limit(1);
    const [slot] = await tx.update(interviewSlots).set({ status: "booked", applicationId: application.id, candidateName: application.candidateName, candidateEmail: application.email, bookedAt: new Date(), updatedAt: new Date() }).where(and(eq(interviewSlots.id, input.slotId), eq(interviewSlots.status, "available"))).returning();
    if (!slot) return { booked: false, error: "slot_unavailable" as const };
    const nextStage = slot.interviewType === "voice" ? "voice_scheduled" : "final_scheduled";
    const previousStage = slot.interviewType === "voice" ? "voice_booking_pending" : "approved_for_final";
    await tx.update(applications).set({ currentStage: nextStage, updatedAt: new Date() }).where(eq(applications.id, application.id));
    // The face-to-face booking confirmation is delivered by the Google
    // Calendar invitation (the candidate is added as an attendee), so its
    // history row is recorded for audit but never queued for an email.
    const confirmationIsEmailed = slot.interviewType === "voice";
     await tx.insert(applicationStatusHistory).values({ organizationId: application.organizationId, applicationId: application.id, stage: slot.interviewType, previousStage, newStage: nextStage, actorEmail: input.actorEmail, source: "internal_api:booking", actionRequestId: input.actionRequestId, notificationStatus: confirmationIsEmailed ? "pending" : "skipped", notificationEventType: slot.interviewType === "voice" ? "voice_booking_confirmation" : "final_booking_confirmation", notificationRecipient: confirmationIsEmailed ? pilotEmailRecipient(application.email).to : "", notificationIntendedRecipient: confirmationIsEmailed ? application.email : "" });
    if (slot.interviewType === "voice") {
      const existing = await tx.select({ id: voiceCallAttempts.id }).from(voiceCallAttempts).where(and(eq(voiceCallAttempts.applicationId, application.id), inArray(voiceCallAttempts.status, ["scheduled", "queued", "calling", "initiated", "in_progress"]))).limit(1);
      if (existing.length === 0) {
        const phone = applicant?.phoneE164 || application.preferredMobile || application.phone || "";
         await tx.insert(voiceCallAttempts).values({ organizationId: application.organizationId, applicationId: application.id, roleId: slot.roleId, attemptNumber: 1, maxAttempts: 3, scheduledAt: slot.startsAt, status: "scheduled", preferredMobile: phone, contactNumber: phone });
      }
    }
    return { booked: true, slot, error: null };
  });
}

/**
 * Slots that still need a Google Calendar event created by the n8n target
 * workflow: booked, face-to-face (voice interviews are phone calls and never
 * get a calendar event), and without a persisted event id. Rows whose last
 * attempt failed are still returned so a retry can pick them up; a row that
 * already carries an event id is never returned, which is what stops a
 * replayed workflow execution from creating a second event.
 */
export async function calendarEventQueue() {
  const db = getDb();
  const rows = await db.select({ slot: interviewSlots, roleExternalId: roles.externalId, roleHrCalendarEmail: roles.hrCalendarEmail, roleSetup: roles.setup, applicationExternalId: applications.externalId })
    .from(interviewSlots)
    .leftJoin(roles, eq(roles.id, interviewSlots.roleId))
    .leftJoin(applications, eq(applications.id, interviewSlots.applicationId))
    .where(and(
      eq(interviewSlots.status, "booked"),
      eq(interviewSlots.interviewType, "final"),
      eq(interviewSlots.calendarEventId, ""),
      not(eq(interviewSlots.calendarEventStatus, "skipped")),
    ))
    .orderBy(asc(interviewSlots.startsAt))
    .limit(LIMIT);
  return rows.map(({ slot, roleExternalId, roleHrCalendarEmail, roleSetup, applicationExternalId }) => ({ ...slot, roleExternalId: roleExternalId || "", roleHrCalendarEmail: roleHrCalendarEmail || "", roleSetup: roleSetup || {}, applicationExternalId: applicationExternalId || "" }));
}

/**
 * Persist the outcome of the n8n Google Calendar node against an interview
 * slot. Idempotent: once a slot carries an event id, a replayed "created"
 * callback with a different id is rejected (no second event is recorded), and
 * the same id is a no-op. A failure is recorded without clearing a prior event
 * id and leaves the slot retryable when none exists yet.
 */
export async function markInterviewCalendarEvent(input: {
  slotId?: string;
  slotCode?: string;
  applicationExternalId?: string;
  interviewType?: "voice" | "final";
  status: "created" | "updated" | "failed" | "skipped";
  eventId?: string;
  eventLink?: string;
  error?: string;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    let slot: typeof interviewSlots.$inferSelect | undefined;
    if (input.slotId) {
      [slot] = await tx.select().from(interviewSlots).where(eq(interviewSlots.id, input.slotId)).for("update").limit(1);
    } else if (input.slotCode) {
      [slot] = await tx.select().from(interviewSlots).where(eq(interviewSlots.slotCode, input.slotCode.trim())).for("update").limit(1);
    } else if (input.applicationExternalId && input.interviewType) {
      const [application] = await tx.select({ id: applications.id }).from(applications).where(eq(applications.externalId, input.applicationExternalId.trim())).limit(1);
      if (application) {
        [slot] = await tx.select().from(interviewSlots)
          .where(and(eq(interviewSlots.applicationId, application.id), eq(interviewSlots.interviewType, input.interviewType), eq(interviewSlots.status, "booked")))
          .orderBy(desc(interviewSlots.bookedAt)).for("update").limit(1);
      }
    }
    if (!slot) return { updated: false, duplicate: false, error: "slot_not_found" as const, eventId: null };

    const incomingId = (input.eventId || "").trim();
    if (input.status === "failed") {
      await tx.update(interviewSlots).set({ calendarEventStatus: "failed", calendarEventError: input.error || "calendar_event_failed", updatedAt: new Date() }).where(eq(interviewSlots.id, slot.id));
      return { updated: true, duplicate: false, error: null, eventId: slot.calendarEventId || null };
    }
    if (slot.calendarEventId && incomingId && slot.calendarEventId !== incomingId) {
      return { updated: false, duplicate: true, error: "calendar_event_already_recorded" as const, eventId: slot.calendarEventId };
    }
    if (slot.calendarEventId && (!incomingId || slot.calendarEventId === incomingId) && input.status !== "updated") {
      return { updated: false, duplicate: true, error: null, eventId: slot.calendarEventId };
    }
    await tx.update(interviewSlots).set({
      calendarEventId: incomingId || slot.calendarEventId,
      calendarEventLink: input.eventLink || slot.calendarEventLink,
      calendarEventStatus: input.status === "skipped" ? "skipped" : input.status === "updated" ? "updated" : "created",
      calendarEventError: "",
      updatedAt: new Date(),
    }).where(eq(interviewSlots.id, slot.id));
    return { updated: true, duplicate: false, error: null, eventId: incomingId || slot.calendarEventId || null };
  });
}

export async function createBookingToken(input: { applicationExternalId: string; kind: BookingTokenKind; tokenHash?: string; link?: string; expiresAt?: string; notify?: boolean }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    // Lock before the lookup so concurrent workflow retries cannot create two
    // random tokens for the same application and interview type.
    const [application] = await tx.select({ id: applications.id, organizationId: applications.organizationId, currentStage: applications.currentStage, email: applications.email }).from(applications).where(eq(applications.externalId, input.applicationExternalId)).for("update").limit(1);
    if (!application) return { token: null, created: false, notificationHistoryId: null, error: "unknown_application" as const };
    // Replays reuse the current pending/active token. Once a token has been
    // used, expired, revoked, or otherwise terminally consumed, a deliberate
    // re-invitation must receive a fresh token and notification identity.
    const [existingToken] = await tx.select().from(bookingTokens)
      .where(and(eq(bookingTokens.applicationId, application.id), eq(bookingTokens.kind, input.kind), inArray(bookingTokens.status, ["pending", "active"])))
      .orderBy(desc(bookingTokens.createdAt)).limit(1);
    if (existingToken) {
      const [existingHistory] = await tx.select({ id: applicationStatusHistory.id }).from(applicationStatusHistory)
        .where(eq(applicationStatusHistory.actionRequestId, `booking-invitation:${input.kind}:${input.applicationExternalId}:${existingToken.tokenHash}`)).limit(1);
      return { token: existingToken, created: false, notificationHistoryId: existingHistory?.id || null, error: null };
    }
    const suppliedTokenHash = input.tokenHash?.trim();
    const rawToken = suppliedTokenHash ? "" : crypto.randomBytes(32).toString("hex");
    const tokenHash = suppliedTokenHash || crypto.createHash("sha256").update(rawToken).digest("hex");
    const portalOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim() || (process.env.VERCEL_URL?.trim() ? `https://${process.env.VERCEL_URL.trim()}` : "https://ella-recruitment-portal-pilot.vercel.app");
    const link = input.link || (input.kind === "avatar"
      ? avatarInterviewLink(portalOrigin, rawToken || tokenHash)
      : `${portalOrigin.replace(/\/$/, "")}/book/${input.kind}/${rawToken || tokenHash}`);
    const [token] = await tx.insert(bookingTokens).values({ organizationId: application.organizationId, applicationId: application.id, kind: input.kind, tokenHash, link, expiresAt: isoOrNull(input.expiresAt) }).onConflictDoNothing({ target: bookingTokens.tokenHash }).returning();
    if (!token) {
      const [existing] = await tx.select().from(bookingTokens).where(eq(bookingTokens.tokenHash, tokenHash)).limit(1);
      return { token: existing ?? null, created: false, notificationHistoryId: null, error: null };
    }
    const nextStage = input.kind === "voice" && application.currentStage === "resume_approved"
      ? "voice_booking_pending"
      : application.currentStage;
    if (nextStage !== application.currentStage) {
      await tx.update(applications).set({ currentStage: nextStage, updatedAt: new Date() }).where(eq(applications.id, application.id));
    }
    if (input.notify === false || input.kind === "avatar") {
      return { token, created: true, notificationHistoryId: null, error: null };
    }
    const [history] = await tx.insert(applicationStatusHistory).values({
      organizationId: application.organizationId,
      applicationId: application.id,
      stage: input.kind,
      previousStage: application.currentStage,
      newStage: nextStage,
      source: `internal_api:${input.kind}_booking_invitation`,
      actionRequestId: `booking-invitation:${input.kind}:${input.applicationExternalId}:${tokenHash}`,
      notificationStatus: "pending",
      notificationEventType: input.kind === "voice" ? "voice_booking_invitation" : "final_booking_invitation",
      notificationRecipient: pilotEmailRecipient(application.email).to,
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

export async function listApplicationBookingTokens(applicationExternalId: string) {
  const db = getDb();
  return db.select({ token: bookingTokens }).from(bookingTokens)
    .innerJoin(applications, eq(applications.id, bookingTokens.applicationId))
    .where(eq(applications.externalId, applicationExternalId.trim()))
    .orderBy(desc(bookingTokens.createdAt)).limit(LIMIT)
    .then((rows) => rows.map(({ token }) => token));
}

export async function markBookingTokenUsed(tokenHash: string) {
  const db = getDb();
  const [token] = await db.update(bookingTokens).set({ status: "used", usedAt: new Date() }).where(and(eq(bookingTokens.tokenHash, tokenHash.trim()), inArray(bookingTokens.status, ["pending", "active"]))).returning({ id: bookingTokens.id });
  return { updated: Boolean(token) };
}

export async function listActiveBookingRoleIds() {
  const db = getDb();
  return db.select({ roleExternalId: roles.externalId, kind: bookingTokens.kind, organizationId: bookingTokens.organizationId })
    .from(bookingTokens)
    .innerJoin(applications, eq(applications.id, bookingTokens.applicationId))
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .where(and(inArray(bookingTokens.status, ["pending", "active"]), or(isNull(bookingTokens.expiresAt), sql`${bookingTokens.expiresAt} >= now()`)))
    .limit(LIMIT);
}

export async function notificationQueue(stage?: string) {
  const db = getDb();
  const cleanStage = stage?.trim();
  // Claim rows while holding database locks. A read-then-ack notifier can
  // otherwise be polled twice by n8n and send the same email twice.
  const { applicationIds, roleIds } = await db.transaction(async (tx) => {
    const now = new Date();
    const leaseCutoff = new Date(now.getTime() - NOTIFICATION_CLAIM_LEASE_MINUTES * 60_000);
    const applicationCandidates = await tx.select({
      id: applicationStatusHistory.id,
      changedAt: applicationStatusHistory.changedAt,
    }).from(applicationStatusHistory)
      .where(and(
        inArray(applicationStatusHistory.notificationStatus, ["", "pending", "failed"]),
        // History rows without an event type are audit-only transitions, not
        // outbound notifications. Excluding them prevents a stage-filtered
        // worker from claiming and sending an unrelated email.
        not(eq(applicationStatusHistory.notificationEventType, "")),
        or(isNull(applicationStatusHistory.notificationAttemptedAt), lte(applicationStatusHistory.notificationAttemptedAt, leaseCutoff)),
        cleanStage ? eq(applicationStatusHistory.newStage, cleanStage) : undefined,
      ))
      .orderBy(asc(applicationStatusHistory.changedAt))
      .for("update", { skipLocked: true })
      .limit(LIMIT);
    const roleCandidates = await tx.select({
      id: roleStatusHistory.id,
      changedAt: roleStatusHistory.changedAt,
    }).from(roleStatusHistory)
      .where(and(
        inArray(roleStatusHistory.notificationStatus, ["", "pending", "failed"]),
        or(isNull(roleStatusHistory.notificationAttemptedAt), lte(roleStatusHistory.notificationAttemptedAt, leaseCutoff)),
        cleanStage ? eq(roleStatusHistory.newStatus, cleanStage) : undefined,
      ))
      .orderBy(asc(roleStatusHistory.changedAt))
      .for("update", { skipLocked: true })
      .limit(LIMIT);
    const selected = [
      ...applicationCandidates.map((candidate) => ({ ...candidate, domain: "application" as const })),
      ...roleCandidates.map((candidate) => ({ ...candidate, domain: "role" as const })),
    ].sort((left, right) => new Date(left.changedAt).valueOf() - new Date(right.changedAt).valueOf()).slice(0, LIMIT);
    const applicationIds = selected.filter((candidate) => candidate.domain === "application").map((candidate) => candidate.id);
    const roleIds = selected.filter((candidate) => candidate.domain === "role").map((candidate) => candidate.id);
    if (applicationIds.length) {
      await tx.update(applicationStatusHistory).set({ notificationAttemptedAt: now }).where(inArray(applicationStatusHistory.id, applicationIds));
    }
    if (roleIds.length) {
      await tx.update(roleStatusHistory).set({ notificationAttemptedAt: now }).where(inArray(roleStatusHistory.id, roleIds));
    }
    return { applicationIds, roleIds };
  });
  const applicationRows = applicationIds.length ? await db.select({
    history: applicationStatusHistory,
    applicationExternalId: applications.externalId,
    candidateName: applications.candidateName,
    candidateEmail: applications.email,
    notificationLink: sql<string>`COALESCE((SELECT bt.link FROM booking_tokens bt WHERE bt.application_id = ${applications.id} AND bt.kind = CASE WHEN ${applicationStatusHistory.notificationEventType} = 'voice_booking_invitation' THEN 'voice' WHEN ${applicationStatusHistory.notificationEventType} = 'final_booking_invitation' THEN 'final' ELSE '' END ORDER BY bt.created_at DESC LIMIT 1), '')`,
    avatarLink: sql<string>`COALESCE((SELECT bt.link FROM booking_tokens bt WHERE bt.application_id = ${applications.id} AND bt.kind = 'avatar' AND bt.status IN ('pending', 'active') ORDER BY bt.created_at DESC LIMIT 1), '')`,
    bookedSlotStartsAt: sql<string>`COALESCE((SELECT to_char(s.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM interview_slots s WHERE s.application_id = ${applications.id} AND s.interview_type = CASE WHEN ${applicationStatusHistory.notificationEventType} = 'voice_booking_confirmation' THEN 'voice' WHEN ${applicationStatusHistory.notificationEventType} = 'final_booking_confirmation' THEN 'final' ELSE '' END AND s.status IN ('booked', 'completed') ORDER BY s.booked_at DESC NULLS LAST LIMIT 1), '')`,
    bookedSlotTimezone: sql<string>`COALESCE((SELECT s.timezone FROM interview_slots s WHERE s.application_id = ${applications.id} AND s.interview_type = CASE WHEN ${applicationStatusHistory.notificationEventType} = 'voice_booking_confirmation' THEN 'voice' WHEN ${applicationStatusHistory.notificationEventType} = 'final_booking_confirmation' THEN 'final' ELSE '' END AND s.status IN ('booked', 'completed') ORDER BY s.booked_at DESC NULLS LAST LIMIT 1), '')`,
    roleExternalId: roles.externalId,
    roleTitle: roles.title,
  }).from(applicationStatusHistory)
    .innerJoin(applications, eq(applications.id, applicationStatusHistory.applicationId))
    .leftJoin(roles, eq(roles.id, applications.roleId))
    .where(inArray(applicationStatusHistory.id, applicationIds))
    .orderBy(asc(applicationStatusHistory.changedAt)).limit(LIMIT) : [];
  const roleRows = roleIds.length ? await db.select({
    history: roleStatusHistory,
    roleExternalId: roles.externalId,
    roleTitle: roles.title,
    departmentSnapshot: roles.departmentSnapshot,
    requesterName: roles.requesterName,
    requesterEmail: roles.requesterEmail,
  }).from(roleStatusHistory)
    .innerJoin(roles, eq(roles.id, roleStatusHistory.roleId))
    .where(inArray(roleStatusHistory.id, roleIds))
    .orderBy(asc(roleStatusHistory.changedAt)).limit(LIMIT) : [];
  const rows = applicationRows;
  const scheduledLabel = (startsAt: string, timezone: string) => {
    const parsed = new Date(startsAt);
    if (!startsAt || Number.isNaN(parsed.getTime())) return "";
    const tz = timezone || "Asia/Singapore";
    const date = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "long", year: "numeric" }).format(parsed);
    const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(parsed);
    return `${date} at ${time} (${tz.replace(/_/g, " ")})`;
  };
  const applicationItems = (() => {
    return rows.map(({ history, ...context }) => ({
      ...history,
      ...context,
      // Email-ready copy so the notifier never renders raw workflow keys.
      eventLabel: notificationEventLabel(history.notificationEventType),
      statusLabel: notificationStatusLabel(history.newStage),
      previousStatusLabel: notificationStatusLabel(history.previousStage),
      summary: notificationSummary(history.notificationEventType, history.comments),
      email: notificationEmail(history.notificationEventType, {
        candidateName: context.candidateName,
        roleTitle: context.roleTitle,
        bookingLink: context.notificationLink,
        avatarLink: context.avatarLink,
        scheduledLabel: scheduledLabel(context.bookedSlotStartsAt, context.bookedSlotTimezone),
      }),
    }));
  })();
  return [
    ...applicationItems.map((item) => ({ ...item, notificationDomain: "application" })),
    ...roleRows.map(({ history, ...context }) => ({ ...history, ...context, eventType: history.action === "role_created" ? "role_request_created" : "role_status_transition", notificationDomain: "role" })),
  ].sort((left, right) => new Date(left.changedAt).valueOf() - new Date(right.changedAt).valueOf()).slice(0, LIMIT);
}

export async function markNotification(input: { historyId: string; status: "sent" | "pending" | "failed" | "not_configured"; error?: string; providerMessageId?: string; recipient?: string }) {
  const db = getDb();
  const [row] = await db.update(applicationStatusHistory).set({ notificationStatus: input.status, notificationError: input.error || "", notificationAttemptedAt: new Date(), notificationSentAt: input.status === "sent" ? new Date() : undefined, notificationProviderId: input.providerMessageId || "", notificationRecipient: input.recipient || undefined }).where(eq(applicationStatusHistory.id, input.historyId)).returning({ id: applicationStatusHistory.id });
  if (row) return { updated: true };
  const [roleRow] = await db.update(roleStatusHistory).set({ notificationStatus: input.status, notificationError: input.error || "", notificationAttemptedAt: new Date() }).where(eq(roleStatusHistory.id, input.historyId)).returning({ id: roleStatusHistory.id });
  return { updated: Boolean(roleRow) };
}
