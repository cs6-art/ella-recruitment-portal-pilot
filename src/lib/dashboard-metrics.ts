import type { RoleRequestSummary } from "@/lib/google-sheets";

export function calculateDashboardMetrics(roles: RoleRequestSummary[]) {
  const count = (status: string) => roles.filter((role) => role.status === status).length;
  return {
    pendingHrDiscussion: count("Pending HR Discussion"),
    approved: count("Approved"),
    rejected: count("Rejected"),
    // "Job Posted" is what `publish_role` sets, so a published role is the most
    // open a position gets. Excluding it made roles disappear from this count at
    // the exact moment they went live.
    openPositions: roles.filter((role) => ["Approved", "Recruitment Setup", "Job Posted"].includes(role.status)).length,
    openPositionsAssumption: "Open Positions counts Approved, Recruitment Setup, and Job Posted.",
    recentRequests: [...roles].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).slice(0, 5),
  };
}
