import { cookies } from "next/headers";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import ApplicantsList from "@/components/ApplicantsList";
import PageHeader from "@/components/ui/PageHeader";
import { filterVisibleApplicants, isDepartmentReviewer } from "@/lib/access-control";
import { getApplicantMetrics, getApplicantsPage } from "@/lib/candidate-applications";
import { getRoleRequests, isPublishedRoleForIntake } from "@/lib/google-sheets";
import { COOKIE_NAME, verifySessionToken, type SessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

function ApplicantsLoading() {
  return <main className="container page applicants-page" aria-busy="true">
    <PageHeader eyebrow="RECRUITMENT PIPELINE" title="Applicants" description="Loading applicant records..." />
    <section className="card" aria-label="Loading applicants">
      <div className="empty">Loading applicants...</div>
    </section>
  </main>;
}

async function ApplicantsData({ user }: { user: SessionUser }) {
  const [applicantPage, metrics, roles] = await Promise.all([
    getApplicantsPage({ page: 1, pageSize: 25, filters: isDepartmentReviewer(user) ? { department: user.department } : undefined }),
    getApplicantMetrics(isDepartmentReviewer(user) ? { department: user.department } : {}),
    getRoleRequests({ liveOnly: true }),
  ]);
  const applicants = filterVisibleApplicants(applicantPage.applicants, user);
  const publishedRoles = roles
    .filter(isPublishedRoleForIntake)
    .map((role) => ({
      roleId: role.roleId,
      label: role.jobTitle || role.roleId,
    }));
  return <ApplicantsList
    applicants={applicants}
    initialTotal={applicantPage.total}
    userEmail={user.email}
    historyMetrics={metrics}
    lastUpdatedAt={new Date().toISOString()}
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
    <Suspense fallback={<ApplicantsLoading />}><ApplicantsData user={user} /></Suspense>
  );
}
