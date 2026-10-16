// Standalone HR notes on an application (Postgres recruitment target only).
// HR-only: nothing here is reachable from a candidate or booking token.

import { and, desc, eq, isNull } from "drizzle-orm";

import { getTenantDb as getDb } from "@/db/client";
import { applicationNotes, applications } from "@/db/schema-recruitment";
import { type ApplicantNote } from "@/lib/applicant-notes-shared";

export { NOTE_MAX_LENGTH, canChangeNote, cleanNoteBody, type ApplicantNote } from "@/lib/applicant-notes-shared";

function toNote(row: typeof applicationNotes.$inferSelect): ApplicantNote {
  return {
    id: row.id, body: row.body, authorName: row.authorName, authorEmail: row.authorEmail,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    edited: row.updatedAt.getTime() - row.createdAt.getTime() > 1000,
  };
}

async function applicationUuid(applicationExternalId: string, organizationId: string) {
  const [row] = await getDb().select({ id: applications.id }).from(applications)
    .where(and(eq(applications.externalId, applicationExternalId), eq(applications.organizationId, organizationId))).limit(1);
  return row?.id ?? null;
}

export async function listApplicantNotes(applicationExternalId: string, organizationId: string): Promise<ApplicantNote[] | null> {
  const applicationId = await applicationUuid(applicationExternalId, organizationId);
  if (!applicationId) return null;
  const rows = await getDb().select().from(applicationNotes)
    .where(and(eq(applicationNotes.applicationId, applicationId), eq(applicationNotes.organizationId, organizationId), isNull(applicationNotes.deletedAt)))
    .orderBy(desc(applicationNotes.createdAt)).limit(200);
  return rows.map(toNote);
}

export async function addApplicantNote(applicationExternalId: string, organizationId: string, author: { name: string; email: string }, body: string): Promise<ApplicantNote | null> {
  const applicationId = await applicationUuid(applicationExternalId, organizationId);
  if (!applicationId) return null;
  const [row] = await getDb().insert(applicationNotes).values({ organizationId, applicationId, body, authorName: author.name, authorEmail: author.email.trim().toLowerCase() }).returning();
  return toNote(row);
}

async function findNote(applicationExternalId: string, organizationId: string, noteId: string) {
  const applicationId = await applicationUuid(applicationExternalId, organizationId);
  if (!applicationId) return null;
  const [row] = await getDb().select().from(applicationNotes)
    .where(and(eq(applicationNotes.id, noteId), eq(applicationNotes.applicationId, applicationId), eq(applicationNotes.organizationId, organizationId), isNull(applicationNotes.deletedAt))).limit(1);
  return row ?? null;
}

export async function getApplicantNote(applicationExternalId: string, organizationId: string, noteId: string) {
  const row = await findNote(applicationExternalId, organizationId, noteId);
  return row ? toNote(row) : null;
}

export async function updateApplicantNote(applicationExternalId: string, organizationId: string, noteId: string, body: string) {
  const row = await findNote(applicationExternalId, organizationId, noteId);
  if (!row) return null;
  const [updated] = await getDb().update(applicationNotes).set({ body, updatedAt: new Date() }).where(eq(applicationNotes.id, row.id)).returning();
  return toNote(updated);
}

export async function deleteApplicantNote(applicationExternalId: string, organizationId: string, noteId: string) {
  const row = await findNote(applicationExternalId, organizationId, noteId);
  if (!row) return false;
  await getDb().update(applicationNotes).set({ deletedAt: new Date() }).where(eq(applicationNotes.id, row.id));
  return true;
}
