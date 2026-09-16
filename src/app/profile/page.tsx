import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import { canAdministerAccess } from "@/lib/access-control";
import {
  COOKIE_NAME,
  verifySessionToken,
} from "@/lib/session";

export const dynamic = "force-dynamic";

function permissionLabel(value: boolean) {
  return value ? "Allowed" : "Not allowed";
}

export default async function ProfilePage() {
  const cookieStore = await cookies();
  const user = verifySessionToken(
    cookieStore.get(COOKIE_NAME)?.value,
  );

  if (!user) {
    redirect("/");
  }

  return (
    <AppShell user={user}>
      <main className="container page">
        <div className="hero-row">
          <div>
            <h1>Profile</h1>
            <p>View your recruitment portal access.</p>
          </div>
        </div>

        <section className="card role-section">
          <div className="card-header">
            <h2>Account details</h2>
          </div>

          <div className="details-grid">
            <div className="detail-item">
              <span className="detail-label">Full name</span>
              <div className="detail-value">{user.name || "Not provided"}</div>
            </div>

            <div className="detail-item">
              <span className="detail-label">Email</span>
              <div className="detail-value">{user.email || "Not provided"}</div>
            </div>

            <div className="detail-item">
              <span className="detail-label">Access role</span>
              <div className="detail-value">{user.accessRole || "Not assigned"}</div>
            </div>

            <div className="detail-item">
              <span className="detail-label">Department</span>
              <div className="detail-value">{user.department || "Not assigned"}</div>
            </div>

            <div className="detail-item">
              <span className="detail-label">Can Create Role Requests</span>
              <div className="detail-value">{permissionLabel(user.canCreateRole)}</div>
            </div>

            <div className="detail-item">
              <span className="detail-label">Can Review Recruitment</span>
              <div className="detail-value">{permissionLabel(user.canReviewRole)}</div>
            </div>

            <div className="detail-item">
              <span className="detail-label">Can Approve Decisions</span>
              <div className="detail-value">{permissionLabel(user.canApproveRole)}</div>
            </div>

              <div className="detail-item">
                <span className="detail-label">Can Manage Smile Credits</span>
                <div className="detail-value">{permissionLabel(user.canManageCredits === true)}</div>
              </div>

              <div className="detail-item">
                <span className="detail-label">Can Manage User Access</span>
                <div className="detail-value">{permissionLabel(canAdministerAccess(user))}</div>
              </div>

              <div className="detail-item">
                <span className="detail-label">Can Edit Settings</span>
              <div className="detail-value">{permissionLabel(user.canEditSettings)}</div>
            </div>

            <div className="detail-item">
              <span className="detail-label">Account status</span>
              <div className="detail-value">
                {user.active === undefined
                  ? "Not available"
                  : user.active
                    ? "Active"
                    : "Inactive"}
              </div>
            </div>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
