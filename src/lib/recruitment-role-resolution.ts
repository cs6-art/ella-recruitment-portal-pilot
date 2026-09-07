import type { RoleRequestDetails } from "@/lib/google-sheets";
import { isPublishedRoleForIntake } from "@/lib/recruitment-role-eligibility";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { targetRoleDetails } from "@/lib/recruitment-target-portal";

/**
 * Resolve an intake role from the configured recruitment source.
 *
 * The source must be selected before any role lookup. In Postgres target mode
 * this function never calls the operational recruitment Sheets repository;
 * Sheets remains the source only when the legacy backend is selected.
 */
export async function resolvePublishedRecruitmentRole(roleId: string): Promise<RoleRequestDetails | null> {
  let normalizedRoleId = "";
  try {
    normalizedRoleId = decodeURIComponent(String(roleId)).trim();
  } catch {
    return null;
  }
  if (!normalizedRoleId) return null;

  const role = isPostgresRecruitmentTarget()
    ? await targetRoleDetails(normalizedRoleId)
    : await (async () => {
      // Keep Sheets out of the target-mode module graph at request time. This
      // preserves legacy behavior without requiring Sheets credentials just to
      // import a Postgres target intake route.
      const { getRoleRequestById } = await import("@/lib/google-sheets");
      return getRoleRequestById(normalizedRoleId);
    })();

  return role && isPublishedRoleForIntake(role) ? role : null;
}
