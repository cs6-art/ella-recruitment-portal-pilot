import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { creditAccounts, organizations, userCredentials } from "@/db/schema";
import {
  applications,
  bookingTokens,
  emailTemplates,
  oauthConnections,
  organizationRecordingDrive,
  portalSettings,
  roles,
  users,
} from "@/db/schema-recruitment";

export type OwnerStatus = "Registered" | "Awaiting registration";
export type OrganizationSetupStatus = "Setup required" | "Partially configured" | "Ready to recruit";

export type OrganizationReadiness = {
  ownerEmail: string;
  ownerStatus: OwnerStatus;
  creditsAdded: boolean;
  recordingStorageApplicable: boolean;
  recordingStorageReady: boolean;
  googleCalendarApplicable: boolean;
  googleCalendarReady: boolean;
  firstRolePublished: boolean;
  hasRoles: boolean;
  overallStatus: OrganizationSetupStatus;
  onboardingEnabled: boolean;
  brandingConfigured: boolean;
  hasCandidates: boolean;
  hasTeammates: boolean;
  automatedEmailsCustomized: boolean;
};

export function calculateOrganizationSetupStatus(input: {
  creditsAdded: boolean;
  recordingStorageApplicable: boolean;
  recordingStorageReady: boolean;
  googleCalendarApplicable: boolean;
  googleCalendarReady: boolean;
  firstRolePublished: boolean;
}): OrganizationSetupStatus {
  const progress = calculateRequiredSetupProgress(input);
  if (progress.complete === progress.total) return "Ready to recruit";
  return progress.complete > 0 ? "Partially configured" : "Setup required";
}

/** Optional branding, teammates, candidates, and email edits never affect required setup progress. */
export function calculateRequiredSetupProgress(input: {
  creditsAdded: boolean;
  recordingStorageApplicable: boolean;
  recordingStorageReady: boolean;
  googleCalendarApplicable: boolean;
  googleCalendarReady: boolean;
  firstRolePublished: boolean;
}) {
  const checks = [
    input.creditsAdded,
    ...(input.recordingStorageApplicable ? [input.recordingStorageReady] : []),
    ...(input.googleCalendarApplicable ? [input.googleCalendarReady] : []),
    input.firstRolePublished,
  ];
  return { complete: checks.filter(Boolean).length, total: checks.length };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function lower(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

/** Reads status only; OAuth credentials and internal tenant identifiers never leave the server. */
export async function getOrganizationReadiness(organizationId: string): Promise<OrganizationReadiness | null> {
  const db = getDb();
  const [organization] = await db.select({
    onboardingStartedAt: organizations.onboardingStartedAt,
  }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) return null;

  const ownerRows = await db.select({ email: users.email, active: users.active })
    .from(users)
    .where(and(
      eq(users.organizationId, organizationId),
      eq(users.isOrganizationOwner, true),
    ));
  const registeredOwner = ownerRows.find((row) => row.active);
  const ownerEmail = lower(registeredOwner?.email);
  const [verifiedCredential] = registeredOwner
    ? await db.select({ id: userCredentials.id }).from(userCredentials).where(and(
      eq(userCredentials.organizationId, organizationId),
      eq(userCredentials.email, lower(registeredOwner.email)),
      sql`${userCredentials.emailVerifiedAt} IS NOT NULL`,
    )).limit(1)
    : [];
  const ownerRegistered = Boolean(registeredOwner && verifiedCredential);
  const ownerStatus: OwnerStatus = ownerRegistered ? "Registered" : "Awaiting registration";

  const [credit] = await db.select({ balance: creditAccounts.balance }).from(creditAccounts)
    .where(and(eq(creditAccounts.organizationId, organizationId), eq(creditAccounts.ownerEmail, "org"))).limit(1);
  const creditsAdded = Number(credit?.balance || 0) > 0;

  const roleRows = await db.select({ status: roles.status, setup: roles.setup, archive: roles.archive, postedAt: roles.postedAt, postingConfirmed: roles.postingConfirmed })
    .from(roles).where(eq(roles.organizationId, organizationId));
  const currentRoles = roleRows.filter((role) => !String(record(role.archive).archivedAt || "").trim());
  const firstRolePublished = currentRoles.some((role) =>
    String(role.status).trim().toLowerCase() === "job_posted" && Boolean(role.postedAt || role.postingConfirmed),
  );
  const googleCalendarApplicable = currentRoles.some((role) =>
    String(record(role.setup).hodInterviewRequired || "").trim().toLowerCase() === "required",
  );
  // Require a Drive destination only after this organization has actually
  // chosen a Live Avatar interview (represented by its avatar booking link).
  const [avatarBooking] = await db.select({ id: bookingTokens.id }).from(bookingTokens).where(and(
    eq(bookingTokens.organizationId, organizationId),
    eq(bookingTokens.kind, "avatar"),
  )).limit(1);
  const recordingStorageApplicable = Boolean(avatarBooking);

  const [recordingDestination] = await db.select({ accountEmail: organizationRecordingDrive.googleAccountEmail, folderId: organizationRecordingDrive.folderId })
    .from(organizationRecordingDrive).where(eq(organizationRecordingDrive.organizationId, organizationId)).limit(1);
  const recordingAccount = lower(recordingDestination?.accountEmail);
  const [recordingOAuth] = recordingAccount
    ? await db.select({ id: oauthConnections.id }).from(oauthConnections).where(and(
      eq(oauthConnections.organizationId, organizationId),
      eq(oauthConnections.provider, "google_drive_recordings"),
      eq(oauthConnections.userEmail, recordingAccount),
      sql`${oauthConnections.refreshTokenEnc} <> ''`,
    )).limit(1)
    : [];
  const recordingStorageReady = Boolean(recordingDestination?.folderId && recordingOAuth);

  const [calendarOAuth] = await db.select({ id: oauthConnections.id }).from(oauthConnections).where(and(
    eq(oauthConnections.organizationId, organizationId),
    eq(oauthConnections.provider, "google_calendar"),
    sql`${oauthConnections.refreshTokenEnc} <> ''`,
  )).limit(1);
  const googleCalendarReady = Boolean(calendarOAuth);

  const [applicantCount] = await db.select({ count: sql<number>`count(*)::int` }).from(applications)
    .where(eq(applications.organizationId, organizationId));
  const [teamCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users)
    .where(and(eq(users.organizationId, organizationId), eq(users.active, true)));
  let automatedEmailsCustomized = false;
  try {
    const [templateCount] = await db.select({ count: sql<number>`count(*)::int` }).from(emailTemplates)
      .where(eq(emailTemplates.organizationId, organizationId));
    automatedEmailsCustomized = Number(templateCount?.count || 0) > 0;
  } catch (error) {
    // Email templates are optional and may not be migrated yet; defaults keep working.
    console.warn("[Organization Readiness] Email-template customization status is unavailable:", error instanceof Error ? error.message : error);
  }

  const brandRows = await db.select({ key: portalSettings.key, value: portalSettings.value }).from(portalSettings)
    .where(and(
      eq(portalSettings.organizationId, organizationId),
      sql`${portalSettings.key} IN ('Organization_Display_Name', 'Organization_Display_Subtitle')`,
    ));
  const brandingConfigured = brandRows.some((row) => row.key === "Organization_Display_Name" && row.value.trim()) &&
    brandRows.some((row) => row.key === "Organization_Display_Subtitle" && row.value.trim());

  const readinessChecks = {
    creditsAdded,
    recordingStorageApplicable,
    recordingStorageReady,
    googleCalendarApplicable,
    googleCalendarReady,
    firstRolePublished,
  };

  return {
    ownerEmail,
    ownerStatus,
    creditsAdded,
    recordingStorageApplicable,
    recordingStorageReady,
    googleCalendarApplicable,
    googleCalendarReady,
    firstRolePublished,
    hasRoles: currentRoles.length > 0,
    overallStatus: calculateOrganizationSetupStatus(readinessChecks),
    onboardingEnabled: Boolean(organization.onboardingStartedAt),
    brandingConfigured,
    hasCandidates: Number(applicantCount?.count || 0) > 0,
    hasTeammates: Number(teamCount?.count || 0) > 1,
    automatedEmailsCustomized,
  };
}
