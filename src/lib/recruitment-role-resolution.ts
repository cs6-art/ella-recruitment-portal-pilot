import type { RoleRequestDetails } from "@/lib/google-sheets";
import { isPublishedRoleForIntake, isRoleOpenForSelection } from "@/lib/recruitment-role-eligibility";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { targetPublicRoleDetails } from "@/lib/recruitment-target-portal";

/**
 * Resolve an intake role from the configured recruitment source.
 *
 * The source must be selected before any role lookup. In Postgres target mode
 * this function never calls the operational recruitment Sheets repository;
 * Sheets remains the source only when the legacy backend is selected.
 */
export async function resolvePublishedRecruitmentRole(roleId: string, organizationId = ""): Promise<RoleRequestDetails | null> {
  let normalizedRoleId = "";
  try {
    normalizedRoleId = decodeURIComponent(String(roleId)).trim();
  } catch {
    return null;
  }
  if (!normalizedRoleId) return null;

  const role = isPostgresRecruitmentTarget()
    ? await targetPublicRoleDetails(normalizedRoleId, organizationId)
    : await (async () => {
      // Keep Sheets out of the target-mode module graph at request time. This
      // preserves legacy behavior without requiring Sheets credentials just to
      // import a Postgres target intake route.
      const { getRoleRequestById } = await import("@/lib/google-sheets");
      return getRoleRequestById(normalizedRoleId);
    })();

  return role && isPublishedRoleForIntake(role) ? role : null;
}

/**
 * Like `resolvePublishedRecruitmentRole`, for routes that start new work on a
 * role (applications, resume uploads and imports). A role past its target
 * hiring date is reported separately so the caller can explain why, while
 * interviews already in progress keep using the plain resolver.
 */
export async function resolveRecruitmentRoleForNewWork(roleId: string, organizationId = ""): Promise<{ role: RoleRequestDetails; error?: undefined } | { role: null; error: "not_published" | "target_date_passed" }> {
  const role = await resolvePublishedRecruitmentRole(roleId, organizationId);
  if (!role) return { role: null, error: "not_published" };
  if (!isRoleOpenForSelection(role)) return { role: null, error: "target_date_passed" };
  return { role };
}
