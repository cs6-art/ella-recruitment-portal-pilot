import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import BulkResumeScreeningPanel from "@/components/BulkResumeScreeningPanel";
import CandidateApplicationForm from "@/components/CandidateApplicationForm";
import ResumeScreeningInviteGenerator from "@/components/ResumeScreeningInviteGenerator";
import { canManagePipeline } from "@/lib/access-control";
import { getRoleRequests, isPublishedRoleForIntake } from "@/lib/google-sheets";
import { isBulkResumeUatMode } from "@/lib/bulk-resume-config";
import { getPortalConfigValue } from "@/lib/portal-config";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { isLiveAvatarConfigured } from "@/lib/live-avatar";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ResumeScreeningPage() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");
  if (!canManagePipeline(user)) redirect("/dashboard");

  // Intake must use the live role sheet even in demo mode so every currently
  // published role is available, not just the synthetic catalogue roles.
  const roles = await getRoleRequests({ liveOnly: true });
  const roleOptions = roles
    .filter(isPublishedRoleForIntake)
    .map((role) => ({ roleId: role.roleId, label: `${role.jobTitle || role.roleId} (${role.roleId})` }))
    // Keep every resume-screening role selector predictable as the published
    // role catalogue grows; IDs remain the option values.
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
  const targetRecruitment = isPostgresRecruitmentTarget();
  const driveRootFolderId = targetRecruitment ? (process.env.RESUME_STORAGE_DRIVE_FOLDER_ID || "").trim() : "";
  // Target mode must not inherit a stale operational Drive URL from the
  // legacy Sheets configuration. The folder ID is navigation-only; the
  // picker submits the exact selected file object's ID.
  const driveUrl = targetRecruitment && driveRootFolderId
    ? `https://drive.google.com/drive/folders/${encodeURIComponent(driveRootFolderId)}`
    : (await getPortalConfigValue("Bulk_Resume_Drive_URL")).trim();

  return (
    <AppShell user={user}>
      <main className="container page resume-screening-page">
        <header className="hero-row resume-screening-header">
          <div>
            <span className="eyebrow-dark">CANDIDATE INTAKE</span>
            <h1>Resume Screening</h1>
            <p>Start an automated CV analysis for a candidate applying to a published role.</p>
          </div>
        </header>
        {isBulkResumeUatMode() ? <div className="uat-mode-banner">UAT MODE · Bulk resume data is routed to the configured UAT destinations.</div> : null}
        <BulkResumeScreeningPanel roleOptions={roleOptions} driveUrl={driveUrl} driveRootFolderId={driveRootFolderId} />
        <ResumeScreeningInviteGenerator roleOptions={roleOptions} />
        <CandidateApplicationForm
          submitUrl="/api/applicants"
          title="CV Analysis"
          description="Upload a single candidate resume to begin the automated screening process."
          submitLabel="Save Screening Record"
          requireConsent={false}
          showRoleSelect
          roleOptions={roleOptions}
          enableLiveAvatar={isLiveAvatarConfigured()}
          successRedirectTo="/applicants"
        />
      </main>
    </AppShell>
  );
}
