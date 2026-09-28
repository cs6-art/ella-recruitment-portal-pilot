import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import BulkResumeScreeningPanel from "@/components/BulkResumeScreeningPanel";
import CandidateApplicationForm from "@/components/CandidateApplicationForm";
import ResumeScreeningInviteGenerator from "@/components/ResumeScreeningInviteGenerator";
import { canManagePipeline } from "@/lib/access-control";
import { getRoleRequests, isPublishedRoleForIntake } from "@/lib/google-sheets";
import { isBulkResumeUatMode } from "@/lib/bulk-resume-config";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { targetRoleSummaries } from "@/lib/recruitment-target-portal";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ResumeScreeningPage() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");
  if (!canManagePipeline(user)) redirect("/dashboard");

  const targetRecruitment = isPostgresRecruitmentTarget();
  // This is an authenticated HR surface, so target mode must use the signed-in
  // organization's roles. The public catalogue intentionally aggregates active
  // organizations, but using it here would show roles that the submit API must
  // correctly reject as belonging to another organization.
  const roles = targetRecruitment ? await targetRoleSummaries({ liveOnly: true }) : await getRoleRequests({ liveOnly: true });
  const roleOptions = roles
    .filter(isPublishedRoleForIntake)
    .map((role) => ({ roleId: role.roleId, label: `${role.jobTitle || role.roleId} (${role.roleId})` }))
    // Keep every resume-screening role selector predictable as the published
    // role catalogue grows; IDs remain the option values.
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
  return (
    <AppShell user={user}>
      <main className="container page resume-screening-page">
        <header className="hero-row resume-screening-header">
          <div>
            <h1>Resume Screening</h1>
            <p>Select a role, add resumes, and review the screening results. Upload files from your computer or import them from cloud storage.</p>
          </div>
        </header>
        {isBulkResumeUatMode() ? <div className="uat-mode-banner">UAT MODE · Bulk resume data is routed to the configured UAT destinations.</div> : null}
        <BulkResumeScreeningPanel roleOptions={roleOptions} />
        <ResumeScreeningInviteGenerator roleOptions={roleOptions} />
        <CandidateApplicationForm
          submitUrl="/api/applicants"
          title="Screen one resume"
          description="Use this option when you want to enter one candidate’s details and submit a single resume."
          submitLabel="Screen resume"
          requireConsent={false}
          showRoleSelect
          roleOptions={roleOptions}
          submitInUploadCard
          successRedirectTo="/applicants"
        />
      </main>
    </AppShell>
  );
}
