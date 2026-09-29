import { getCalendarConnection } from "@/lib/calendar-tokens";
import { getDirectoryUsers } from "@/lib/google-sheets";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organization-accounts";
import { getPostgresDirectoryUsers } from "@/lib/postgres-directory";
import { runWithTenantDatabase } from "@/lib/tenant-database";

/** Active HR reviewers in the caller's organization, and whether each has connected their own calendar. */
export async function listEligibleInterviewers(organizationId: string) {
  const registered = await runWithTenantDatabase(organizationId, () => getPostgresDirectoryUsers(organizationId));
  const directory = organizationId === DEFAULT_ORGANIZATION_ID
    ? [...(await getDirectoryUsers()), ...registered]
    : registered;
  const seen = new Set<string>();
  const eligible = directory.filter((user) => {
    const email = user.email.trim().toLowerCase();
    if (!user.active || !user.canReviewRole || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
  return Promise.all(eligible.map(async (user) => {
    const connection = await getCalendarConnection(user.email).catch(() => null);
    return { email: user.email.trim().toLowerCase(), name: user.fullName || user.email, calendarConnected: Boolean(connection?.refreshToken) };
  }));
}
