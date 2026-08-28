import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import DashboardMetrics from "@/components/DashboardMetrics";
import UiIcon from "@/components/UiIcon";
import {
  COOKIE_NAME,
  verifySessionToken,
} from "@/lib/session";

export const dynamic = "force-dynamic";

function LimitedAccessCard({ user }: { user: { accessRole?: string; department?: string; canEditSettings?: boolean } }) {
  return <section className="limited-access-card" aria-labelledby="limited-access-title"><div className="limited-access-icon" aria-hidden="true"><UiIcon name="info" size={20} /></div><div><h2 id="limited-access-title">Limited access</h2><p>Your McLink account is active, but recruitment access has not been assigned.</p><small>Contact HR or the portal administrator if you need permission to submit or review role requests.</small><dl className="limited-access-details"><div><dt>Access role</dt><dd>{String(user.accessRole ?? "Portal User")}</dd></div><div><dt>Department</dt><dd>{String(user.department ?? "Not assigned")}</dd></div>{user.canEditSettings === true && <div><dt>Settings access</dt><dd>Available</dd></div>}</dl>{user.canEditSettings === true && <Link className="btn btn-secondary" href="/settings">Open Settings</Link>}</div></section>;
}

export default async function DashboardPage() {
  const cookieStore = await cookies();

  const user = verifySessionToken(
    cookieStore.get(COOKIE_NAME)?.value,
  );

  if (!user) {
    redirect("/");
  }

  const userName =
    String(user.name ?? "").trim() ||
    "McLink User";

  const firstName =
    userName.split(" ")[0] || userName;

  const hasRecruitmentAccess = user.canCreateRole === true || user.canReviewRole === true || user.canApproveRole === true;
  const creatorOnly = user.canCreateRole === true && user.canReviewRole !== true && user.canApproveRole !== true;

  return (
    <AppShell user={user}>
      <main className="container page">
        <section className="dashboard-welcome">
          <div>
            <span className="dashboard-eyebrow">
              Recruitment Portal
            </span>

            <h1>
              Welcome back, {firstName}
            </h1>

            <p>
              Monitor role requests and recruitment
              progress from one place.
            </p>
            <span className="dashboard-access-badge">
              {String(user.accessRole ?? "Portal User")} · {String(user.department ?? "Department not assigned")} Department
            </span>
          </div>
          {user.canCreateRole === true && <div className="hero-actions dashboard-welcome-actions"><Link className="btn btn-primary" href="/roles/new">Create Role Request</Link></div>}
        </section>

        {hasRecruitmentAccess ? <section className="dashboard-stats"><DashboardMetrics scope={creatorOnly ? "personal" : "organization"} /></section> : <LimitedAccessCard user={user} />}
        <section className="dashboard-grid">
          <article className="dashboard-panel">
            <div className="dashboard-panel-header">
              <div>
                <h2>
                  Recruitment workflow
                </h2>

                <p>
                  Every approved request follows these five stages.
                </p>
              </div>
            </div>

            <div className="workflow-list">
              <div className="workflow-item">
                <span className="workflow-number">
                  1
                </span>

                <div>
                  <strong>
                    Role request submitted
                  </strong>

                  <p>
                    HR or the authorised requester
                    submits the staffing requirement.
                  </p>
                </div>
              </div>

              <div className="workflow-item">
                <span className="workflow-number">
                  2
                </span>

                <div>
                  <strong>
                    HR review and approval
                  </strong>

                  <p>
                    HR reviews the requirements, then
                    approves, returns, rejects, or
                    holds the request.
                  </p>
                </div>
              </div>

              <div className="workflow-item">
                <span className="workflow-number">
                  3
                </span>

                <div>
                  <strong>Recruitment Setup</strong>

                  <p>
                    HR prepares screening criteria and interview setup.
                  </p>
                </div>
              </div>

              <div className="workflow-item">
                <span className="workflow-number">4</span>
                <div>
                  <strong>Job Posting</strong>
                  <p>The approved role is published on the selected channels.</p>
                </div>
              </div>
            </div>
          </article>

          {hasRecruitmentAccess && <aside className="dashboard-panel">
            <div className="dashboard-panel-header">
              <div>
                <h2>User access summary</h2>
                <p>{creatorOnly ? "Your access is focused on creating and tracking your own requests." : "Your access determines which role actions appear in the top navigation."}</p>
              </div>
            </div>

            <div className="details-grid">
              <div className="detail-item">
                <span className="detail-label">Access role</span>
                <div className="detail-value">{user.accessRole || "Not assigned"}</div>
              </div>

              <div className="detail-item">
                <span className="detail-label">Department</span>
                <div className="detail-value">{user.department || "Not assigned"}</div>
              </div>

              <div className="detail-item">
                <span className="detail-label">Can Create Role</span>
                <div className="detail-value">{user.canCreateRole ? "Allowed" : "Not allowed"}</div>
              </div>

              <div className="detail-item">
                <span className="detail-label">Can Review Role</span>
                <div className="detail-value">{user.canReviewRole ? "Allowed" : "Not allowed"}</div>
              </div>

              <div className="detail-item">
                <span className="detail-label">Can Review Own Department</span>
                <div className="detail-value">{user.canReviewDepartmentRole ? "Allowed" : "Not allowed"}</div>
              </div>

              <div className="detail-item">
                <span className="detail-label">Can Approve Role</span>
                <div className="detail-value">{user.canApproveRole ? "Allowed" : "Not allowed"}</div>
              </div>

              <div className="detail-item">
                <span className="detail-label">Can Edit Settings</span>
                <div className="detail-value">{user.canEditSettings ? "Allowed" : "Not allowed"}</div>
              </div>
            </div>
          </aside>}
        </section>
      </main>
    </AppShell>
  );
}
