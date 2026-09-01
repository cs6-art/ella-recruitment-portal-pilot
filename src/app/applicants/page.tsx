import { cookies } from "next/headers";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import ApplicantsList from "@/components/ApplicantsList";
import { filterVisibleApplicants } from "@/lib/access-control";
import { getApplicantMetrics, getApplicants } from "@/lib/candidate-applications";
import { getRoleRequests, isPublishedRoleForIntake } from "@/lib/google-sheets";
import { COOKIE_NAME, verifySessionToken, type SessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

function ApplicantsLoading() {
  return <main className="container page applicants-page" aria-busy="true">
    <header className="hero-row">
      <div>
        <span className="eyebrow-dark">RECRUITMENT PIPELINE</span>
        <h1>Applicants</h1>
        <p>Loading applicant records...</p>
      </div>
    </header>
    <section className="card" aria-label="Loading applicants">
      <div className="empty">Loading applicants...</div>
    </section>
  </main>;
}

async function ApplicantsData({ user }: { user: SessionUser }) {
  const [allApplicants, metrics, roles] = await Promise.all([getApplicants(), getApplicantMetrics(), getRoleRequests({ liveOnly: true })]);
  const applicants = filterVisibleApplicants(allApplicants, user);
  const publishedRoles = roles
    .filter(isPublishedRoleForIntake)
    .map((role) => ({
      roleId: role.roleId,
      label: role.jobTitle || role.roleId,
    }));
  return <ApplicantsList
    applicants={applicants}
    userEmail={user.email}
    historyMetrics={metrics}
    publishedRoles={publishedRoles}
    canManageApplicants={user.canReviewRole === true}
    description={user.canReviewDepartmentRole === true && user.canReviewRole !== true && user.canApproveRole !== true
      ? "Review applicants for your department as they move through the recruitment workflow."
      : "Review every applicant as they move through the recruitment workflow."}
  />;
}

export default async function ApplicantsPage() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");
  if (user.canReviewRole !== true && user.canApproveRole !== true && user.canReviewDepartmentRole !== true) redirect("/dashboard");
  return (
    <AppShell user={user}><Suspense fallback={<ApplicantsLoading />}><ApplicantsData user={user} /></Suspense></AppShell>
  );
}
