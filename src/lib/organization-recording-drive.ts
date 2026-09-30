import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { organizationRecordingDrive } from "@/db/schema-recruitment";

export type OrganizationRecordingDrive = {
  organizationId: string;
  googleAccountEmail: string;
  folderId: string;
  folderName: string;
  connectedByEmail: string;
  updatedAt: string;
};

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function getOrganizationRecordingDrive(organizationId: string): Promise<OrganizationRecordingDrive | null> {
  const [row] = await getDb().select().from(organizationRecordingDrive)
    .where(eq(organizationRecordingDrive.organizationId, organizationId.trim()))
    .limit(1);
  if (!row) return null;
  return {
    organizationId: row.organizationId,
    googleAccountEmail: row.googleAccountEmail,
    folderId: row.folderId,
    folderName: row.folderName,
    connectedByEmail: row.connectedByEmail,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveOrganizationRecordingDrive(input: {
  organizationId: string;
  googleAccountEmail?: string;
  folderId?: string;
  folderName?: string;
  connectedByEmail?: string;
  updatedByEmail: string;
}): Promise<void> {
  const organizationId = input.organizationId.trim();
  const [existing] = await getDb().select().from(organizationRecordingDrive)
    .where(eq(organizationRecordingDrive.organizationId, organizationId))
    .limit(1);
  const accountEmail = input.googleAccountEmail === undefined
    ? existing?.googleAccountEmail || ""
    : normalizedEmail(input.googleAccountEmail);
  const sameAccount = accountEmail === (existing?.googleAccountEmail || "");
  const now = new Date();

  await getDb().insert(organizationRecordingDrive).values({
    organizationId,
    googleAccountEmail: accountEmail,
    // A newly connected Google account must explicitly choose its own folder.
    folderId: input.folderId === undefined ? (sameAccount ? existing?.folderId || "" : "") : input.folderId.trim(),
    folderName: input.folderName === undefined ? (sameAccount ? existing?.folderName || "" : "") : input.folderName.trim(),
    connectedByEmail: input.connectedByEmail === undefined ? existing?.connectedByEmail || "" : normalizedEmail(input.connectedByEmail),
    updatedByEmail: normalizedEmail(input.updatedByEmail),
    updatedAt: now,
  }).onConflictDoUpdate({
    target: organizationRecordingDrive.organizationId,
    set: {
      googleAccountEmail: accountEmail,
      folderId: input.folderId === undefined ? (sameAccount ? existing?.folderId || "" : "") : input.folderId.trim(),
      folderName: input.folderName === undefined ? (sameAccount ? existing?.folderName || "" : "") : input.folderName.trim(),
      connectedByEmail: input.connectedByEmail === undefined ? existing?.connectedByEmail || "" : normalizedEmail(input.connectedByEmail),
      updatedByEmail: normalizedEmail(input.updatedByEmail),
      updatedAt: now,
    },
  });
}

export async function clearOrganizationRecordingDrive(organizationId: string, updatedByEmail: string): Promise<void> {
  const current = await getOrganizationRecordingDrive(organizationId);
  if (!current) return;
  await saveOrganizationRecordingDrive({
    organizationId,
    googleAccountEmail: "",
    folderId: "",
    folderName: "",
    connectedByEmail: "",
    updatedByEmail,
  });
}
