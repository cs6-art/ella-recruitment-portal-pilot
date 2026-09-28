import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import DashboardMetrics from "@/components/DashboardMetrics";
import UiIcon from "@/components/UiIcon";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

function LimitedAccessCard({ canEditSettings }: { canEditSettings: boolean }) {
  return <section className="limited-access-card" aria-labelledby="limited-access-title">
    <div className="limited-access-icon" aria-hidden="true"><UiIcon name="info" size={20} /></div>
    <div>
      <h2 id="limited-access-title">Your workspace is ready</h2>
      <p>Your account is active, but recruitment access has not been assigned yet.</p>
      <p className="limited-access-help">Ask your HR contact or portal administrator to give you access to the recruitment tasks you need.</p>
      {canEditSettings && <Link className="btn btn-secondary" href="/settings">Open settings</Link>}
    </div>
  </section>;
}

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const user = verifySessionToken(cookieStore.get(COOKIE_NAME)?.value);
  if (!user) redirect("/");

  const userName = String(user.name ?? "").trim().split(/\s+/)[0] || "there";
  const hasRecruitmentAccess = user.canCreateRole === true || user.canReviewRole === true || user.canApproveRole === true || user.canReviewDepartmentRole === true;
  const creatorOnly = user.canCreateRole === true && user.canReviewRole !== true && user.canApproveRole !== true;

  return <AppShell user={user}>
    {hasRecruitmentAccess
      ? <DashboardMetrics
          scope={creatorOnly ? "personal" : "organization"}
          organizationId={user.organizationId}
          userName={userName}
          canCreateRole={user.canCreateRole}
          canReviewRole={user.canReviewRole}
          canApproveRole={user.canApproveRole}
        />
      : <main className="container page dashboard-page">
          <header className="dashboard-welcome dashboard-welcome-limited"><div><h1>Hello, {userName}</h1><p>Here’s what needs your attention today.</p></div></header>
          <LimitedAccessCard canEditSettings={user.canEditSettings} />
        </main>}
  </AppShell>;
}
