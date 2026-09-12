import { and, eq } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db/client";
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
      .leftJoin(departments, eq(departments.id, users.departmentId))
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
