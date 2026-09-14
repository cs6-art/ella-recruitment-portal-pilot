import { and, eq } from "drizzle-orm";

import { getDb, getTenantDb, isDatabaseConfigured } from "@/db/client";
import { organizations } from "@/db/schema";
import { departments, users } from "@/db/schema-recruitment";
import type { DirectoryUser } from "@/lib/google-sheets";

function directoryUserFromRow(row: {
  email: string;
  fullName: string | null;
  accessRole: string | null;
  departmentName: string | null;
  canCreateRole: boolean;
  canReviewRole: boolean;
  canApproveRole: boolean;
  canEditSettings: boolean;
  canManageUsers: boolean;
  canReviewDepartmentRole: boolean;
  active: boolean;
}): DirectoryUser {
  return {
    email: row.email.trim().toLowerCase(),
    fullName: row.fullName || "",
    accessRole: row.accessRole || "",
    department: row.departmentName || "",
    canCreateRole: row.canCreateRole,
    canReviewRole: row.canReviewRole,
    canApproveRole: row.canApproveRole,
    canEditSettings: row.canEditSettings,
    canManageUsers: row.canManageUsers,
    canReviewDepartmentRole: row.canReviewDepartmentRole,
    active: row.active,
  };
}

/**
 * Client-organization login fallback (see [[roadmap]] / DATABASE-MIGRATION-PLAN.md
 * item #2 "users auth source"). McLink's own staff keep authenticating from the
 * Google Sheet `User_Directory` exactly as before — this is only ever consulted
 * for a non-default organization, i.e. a client tenant that has no Sheet row and
 * never will. It intentionally does not touch, replace, or race the Sheet path.
 *
 * A client's first HR account is provisioned by
 * `npm run db:provision:organization` (src/db/provision-client-organization.mjs),
 * which writes the matching `users` row this reads.
 */
export async function findPostgresDirectoryUser(email: string, organizationId: string): Promise<DirectoryUser | null> {
  if (!isDatabaseConfigured()) return null;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !organizationId.trim()) return null;

  const db = getTenantDb();
  try {
    const [row] = await db
      .select({
        email: users.email,
        fullName: users.fullName,
        accessRole: users.accessRole,
        departmentName: departments.name,
        canCreateRole: users.canCreateRole,
        canReviewRole: users.canReviewRole,
        canApproveRole: users.canApproveRole,
        canEditSettings: users.canEditSettings,
        canManageUsers: users.canManageUsers,
        canReviewDepartmentRole: users.canReviewDepartmentRole,
        active: users.active,
      })
      .from(users)
      .leftJoin(departments, and(eq(departments.id, users.departmentId), eq(departments.organizationId, users.organizationId)))
      .where(and(eq(users.email, normalizedEmail), eq(users.organizationId, organizationId)))
      .limit(1);
    if (!row) return null;
    return directoryUserFromRow(row);
  } catch (error) {
    // The recruitment-core tables are an opt-in migration; a client org
    // provisioned before that migration ran must not crash login.
    console.error("[Postgres Directory] Lookup unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function getPostgresDirectoryUsers(organizationId: string): Promise<DirectoryUser[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getTenantDb();
  const rows = await db
    .select({
      email: users.email,
      fullName: users.fullName,
      accessRole: users.accessRole,
      departmentName: departments.name,
      canCreateRole: users.canCreateRole,
      canReviewRole: users.canReviewRole,
      canApproveRole: users.canApproveRole,
      canEditSettings: users.canEditSettings,
      canManageUsers: users.canManageUsers,
      canReviewDepartmentRole: users.canReviewDepartmentRole,
      active: users.active,
    })
    .from(users)
    .leftJoin(departments, and(eq(departments.id, users.departmentId), eq(departments.organizationId, users.organizationId)))
    .where(eq(users.organizationId, organizationId))
    .orderBy(users.email);
  return rows.map(directoryUserFromRow);
}

export async function upsertPostgresDirectoryUser(organizationId: string, user: DirectoryUser, originalEmail?: string): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error("Database is not configured.");
  const db = getTenantDb();
  const email = user.email.trim().toLowerCase();
  const previousEmail = originalEmail?.trim().toLowerCase();
  const [existingEmail] = await db.select({ id: users.id, organizationId: users.organizationId }).from(users).where(eq(users.email, email)).limit(1);
  if (existingEmail && existingEmail.organizationId !== organizationId) throw new Error("The email already belongs to another organization.");
  const [existing] = previousEmail
    ? await db.select({ id: users.id, organizationId: users.organizationId }).from(users).where(eq(users.email, previousEmail)).limit(1)
    : [];
  if (previousEmail && (!existing || existing.organizationId !== organizationId)) throw new Error("The account being edited no longer exists.");
  if (!previousEmail && existingEmail) throw new Error("An account already exists for that email address.");

  const departmentName = user.department.trim();
  let departmentId: string | null = null;
  if (departmentName) {
    const nameKey = departmentName.toLowerCase();
    const [department] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.organizationId, organizationId), eq(departments.nameKey, nameKey))).limit(1);
    if (department) departmentId = department.id;
    else {
      const [created] = await db.insert(departments).values({ organizationId, name: departmentName, nameKey }).onConflictDoNothing({ target: [departments.organizationId, departments.nameKey] }).returning({ id: departments.id });
      if (created) departmentId = created.id;
      else {
        const [existingDepartment] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.organizationId, organizationId), eq(departments.nameKey, nameKey))).limit(1);
        departmentId = existingDepartment?.id || null;
      }
    }
  }

  const values = {
    email,
    fullName: user.fullName.trim(),
    accessRole: user.accessRole.trim(),
    departmentId,
    canCreateRole: user.canCreateRole,
    canReviewRole: user.canReviewRole,
    canApproveRole: user.canApproveRole,
    canEditSettings: user.canEditSettings,
    canManageUsers: user.canManageUsers,
    canReviewDepartmentRole: user.canReviewDepartmentRole,
    active: user.active,
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(users).set(values).where(and(eq(users.id, existing.id), eq(users.organizationId, organizationId)));
  } else {
    await db.insert(users).values({ organizationId, ...values });
  }
}

/**
 * Find a directory row by identity when the membership mirror is missing.
 * The users table is itself a tenant-scoped directory, so an active
 * organization row is required before it can grant access. The current
 * schema keeps user email globally unique; limiting this query to one row
 * also fails closed if that invariant is ever relaxed without adding tenant
 * selection to the session model.
 */
export async function findPostgresDirectoryUserByEmail(email: string): Promise<{ organizationId: string; user: DirectoryUser } | null> {
  if (!isDatabaseConfigured()) return null;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const db = getDb();
  try {
    const rows = await db
      .select({
        organizationId: users.organizationId,
        organizationActive: organizations.active,
        email: users.email,
        fullName: users.fullName,
        accessRole: users.accessRole,
        departmentName: departments.name,
        canCreateRole: users.canCreateRole,
        canReviewRole: users.canReviewRole,
        canApproveRole: users.canApproveRole,
        canEditSettings: users.canEditSettings,
        canManageUsers: users.canManageUsers,
        canReviewDepartmentRole: users.canReviewDepartmentRole,
        active: users.active,
      })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .leftJoin(departments, and(eq(departments.id, users.departmentId), eq(departments.organizationId, users.organizationId)))
      .where(eq(users.email, normalizedEmail))
      .limit(2);
    const row = rows.length === 1 && rows[0]?.organizationActive === true ? rows[0] : null;
    if (!row) return null;
    return {
      organizationId: row.organizationId,
      user: {
        email: normalizedEmail,
        fullName: row.fullName || "",
        accessRole: row.accessRole || "",
        department: row.departmentName || "",
        canCreateRole: row.canCreateRole,
        canReviewRole: row.canReviewRole,
        canApproveRole: row.canApproveRole,
        canEditSettings: row.canEditSettings,
        canManageUsers: row.canManageUsers,
        active: row.active,
        canReviewDepartmentRole: row.canReviewDepartmentRole,
      },
    };
  } catch (error) {
    // The recruitment-core tables are optional until the reviewed cutover.
    console.error("[Postgres Directory] Cross-organization lookup unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}
