import { and, desc, eq, gt, inArray, notExists, sql } from "drizzle-orm";

import { getTenantDb as getDb } from "@/db/client";
import { applicantSeen, applications, roles, userNotificationState } from "@/db/schema-recruitment";

/**
 * Server-side, per-user "new applicant" read state (drizzle/0039).
 *
 * An application is NEW for a user when it arrived after the user's
 * `applicants_cleared_at` (set on first use and by "Mark all as read") and the
 * user has not opened it (no `applicant_seen` row). Every query is limited to
 * one organization, and a user's state never affects anyone else's.
 */

const RECENT_LIMIT = 50;

function key(organizationId: string, userEmail: string) {
  return { organizationId: organizationId.trim(), userEmail: userEmail.trim().toLowerCase() };
}

/** The user's "cleared at" watermark. First use starts it at now, so older applicants are not all flagged NEW. */
export async function applicantsClearedAt(organizationId: string, userEmail: string): Promise<Date> {
  const db = getDb();
  const id = key(organizationId, userEmail);
  await db.insert(userNotificationState).values({ organizationId: id.organizationId, userEmail: id.userEmail }).onConflictDoNothing();
  const [row] = await db.select({ clearedAt: userNotificationState.applicantsClearedAt }).from(userNotificationState)
    .where(and(eq(userNotificationState.organizationId, id.organizationId), eq(userNotificationState.userEmail, id.userEmail))).limit(1);
  return row?.clearedAt ?? new Date();
}

function unseenConditions(organizationId: string, userEmail: string, clearedAt: Date, department = "") {
  const conditions = [
    eq(applications.organizationId, organizationId),
    eq(roles.organizationId, organizationId),
    eq(applications.withdrawn, false),
    gt(applications.appliedAt, clearedAt),
    notExists(getDb().select({ one: sql`1` }).from(applicantSeen).where(and(
      eq(applicantSeen.organizationId, organizationId),
      eq(applicantSeen.userEmail, userEmail),
      eq(applicantSeen.applicationId, applications.id),
    ))),
  ];
  if (department.trim()) conditions.push(sql`lower(trim(${roles.departmentSnapshot})) = lower(trim(${department.trim()}))`);
  return conditions;
}

/** The user's unseen applicants (newest first) and how many there are in total. */
export async function listUnseenApplicants(organizationId: string, userEmail: string, options: { department?: string } = {}) {
  const db = getDb();
  const id = key(organizationId, userEmail);
  const clearedAt = await applicantsClearedAt(id.organizationId, id.userEmail);
  const where = and(...unseenConditions(id.organizationId, id.userEmail, clearedAt, options.department));
  const [rows, [count]] = await Promise.all([
    db.select({ applicationId: applications.externalId, candidateName: applications.candidateName, selectedRole: roles.title, appliedAt: applications.appliedAt })
      .from(applications).innerJoin(roles, eq(roles.id, applications.roleId))
      .where(where).orderBy(desc(applications.appliedAt)).limit(RECENT_LIMIT),
    db.select({ n: sql<number>`count(*)::int` }).from(applications).innerJoin(roles, eq(roles.id, applications.roleId)).where(where),
  ]);
  return {
    total: count?.n ?? 0,
    applicants: rows.map((row) => ({ applicationId: row.applicationId, candidateName: row.candidateName, selectedRole: row.selectedRole, appliedAt: row.appliedAt.toISOString() })),
  };
}

/** Which of these application references are still NEW for the user (for list row highlights). */
export async function unseenApplicationIds(organizationId: string, userEmail: string, applicationExternalIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(applicationExternalIds.map((value) => value.trim()).filter(Boolean))];
  if (ids.length === 0) return new Set();
  const db = getDb();
  const id = key(organizationId, userEmail);
  const clearedAt = await applicantsClearedAt(id.organizationId, id.userEmail);
  const rows = await db.select({ applicationId: applications.externalId }).from(applications).innerJoin(roles, eq(roles.id, applications.roleId))
    .where(and(inArray(applications.externalId, ids), ...unseenConditions(id.organizationId, id.userEmail, clearedAt)));
  return new Set(rows.map((row) => row.applicationId));
}

/** Record that the user opened this applicant. Idempotent; another organization's reference is ignored. */
export async function markApplicantSeen(organizationId: string, userEmail: string, applicationExternalId: string): Promise<boolean> {
  const db = getDb();
  const id = key(organizationId, userEmail);
  const [application] = await db.select({ id: applications.id }).from(applications)
    .where(and(eq(applications.externalId, applicationExternalId.trim()), eq(applications.organizationId, id.organizationId))).limit(1);
  if (!application) return false;
  await db.insert(applicantSeen).values({ organizationId: id.organizationId, userEmail: id.userEmail, applicationId: application.id }).onConflictDoNothing();
  return true;
}

/** "Mark all as read": everything that has arrived so far stops being NEW for this user only. */
export async function markAllApplicantsSeen(organizationId: string, userEmail: string) {
  const db = getDb();
  const id = key(organizationId, userEmail);
  const now = new Date();
  await db.insert(userNotificationState).values({ organizationId: id.organizationId, userEmail: id.userEmail, applicantsClearedAt: now })
    .onConflictDoUpdate({ target: [userNotificationState.organizationId, userNotificationState.userEmail], set: { applicantsClearedAt: now, updatedAt: now } });
  return now;
}
