import { and, eq } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db/client";
import { organizations } from "@/db/schema";
import { departments, users } from "@/db/schema-recruitment";
import type { DirectoryUser } from "@/lib/google-sheets";

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

  const db = getDb();
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
    return {
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
    };
  } catch (error) {
    // The recruitment-core tables are an opt-in migration; a client org
    // provisioned before that migration ran must not crash login.
    console.error("[Postgres Directory] Lookup unavailable:", error instanceof Error ? error.message : error);
    return null;
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
