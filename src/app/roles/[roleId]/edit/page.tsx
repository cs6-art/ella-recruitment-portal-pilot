import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import AppShell from "@/components/AppShell";
import RecruitmentSetupEditor from "@/components/RecruitmentSetupEditor";
import RoleRequestForm, { type RoleRequestFormValues } from "@/components/RoleRequestForm";
import { canEditRoleRequest, canViewRole } from "@/lib/access-control";
import { getRoleRequestById } from "@/lib/google-sheets";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

type EditRolePageProps = {
  params: Promise<{ roleId: string }>;
};

function screeningQuestions(value: string) {
  if (!value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  } catch {
    // Legacy rows store the questions as one question per line.
  }
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function setupChannels(value: string) {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

export default async function EditRolePage({ params }: EditRolePageProps) {
  const cookieStore = await cookies();
  const user = verifySessionToken(cookieStore.get(COOKIE_NAME)?.value);
  if (!user) redirect("/");

  const { roleId: encodedRoleId } = await params;
  const roleId = decodeURIComponent(encodedRoleId);
  const role = await getRoleRequestById(roleId, { fresh: true });
  if (!role || !canViewRole(user, role) || !canEditRoleRequest(user, role)) redirect(`/roles/${encodeURIComponent(roleId)}`);

  const initialValues: Partial<RoleRequestFormValues> = {
    requestType: role.requestType || "Staff Addition",
    department: role.department,
    jobTitle: role.jobTitle,
    employmentType: role.employmentType || "Full-Time",
    numberOfVacancies: role.numberOfVacancies || 1,
    reasonForRequest: role.reasonForRequest,
    jobDescription: role.jobDescription,
    replacementEmployee: role.replacementEmployee,
    targetHiringDate: role.targetHiringDate,
    hodEmail: role.hodEmail,
    customScreeningQuestion1: role.customScreeningQuestion1,
    customScreeningQuestion2: role.customScreeningQuestion2,
    aiGeneratedScreeningQuestions: screeningQuestions(role.aiGeneratedScreeningQuestions),
    recruitmentSetupDraft: {
      jobDescription: role.jobDescription,
      screeningCriteria: role.screeningCriteria,
      requiredInterviewQuestion1: role.requiredInterviewQuestion1 || "",
      requiredInterviewQuestion2: role.requiredInterviewQuestion2 || "",
      requiredInterviewQuestion3: role.requiredInterviewQuestion3 || "",
      requiredInterviewQuestion4: role.requiredInterviewQuestion4 || "",
      requiredInterviewQuestion5: role.requiredInterviewQuestion5 || "",
      keywordsToLookFor: role.keywordsToLookFor || "",
      minimumYearsOfExperience: role.minimumYearsOfExperience || "",
      transferableSkillsAccepted: role.transferableSkillsAccepted || "",
      licenseOrCertificateRequired: role.licenseOrCertificateRequired || "",
      salaryOrBudgetRange: role.salaryOrBudgetRange || "",
      earliestAvailabilityRule: role.earliestAvailabilityRule || "",
      evaluationFieldToggles: role.evaluationFieldToggles ? setupChannels(role.evaluationFieldToggles) : [],
      customEvaluationFields: role.customEvaluationFields || [],
      postingChannels: setupChannels(role.postingChannels),
    },
  };
  const recruitmentSetup = {
    roleTitle: role.jobTitle,
    aiInterviewerName: "Ella",
    aiInterviewerBehavior: role.interviewBehavior || "",
    requiredInterviewQuestion1: role.requiredInterviewQuestion1 || "",
    requiredInterviewQuestion2: role.requiredInterviewQuestion2 || "",
    requiredInterviewQuestion3: role.requiredInterviewQuestion3 || "",
    requiredInterviewQuestion4: role.requiredInterviewQuestion4 || "",
    requiredInterviewQuestion5: role.requiredInterviewQuestion5 || "",
    hodScreeningQuestion1: role.customScreeningQuestion1 || "",
    hodScreeningQuestion2: role.customScreeningQuestion2 || "",
    aiGeneratedScreeningQuestions: role.aiGeneratedScreeningQuestions || "",
    finalAiEvaluationTemplate: "",
    jobDescription: role.jobDescription,
    screeningCriteria: role.screeningCriteria,
    initialInterviewQuestions: [role.requiredInterviewQuestion1, role.requiredInterviewQuestion2, role.requiredInterviewQuestion3, role.requiredInterviewQuestion4, role.requiredInterviewQuestion5].filter(Boolean).join("\n"),
    aiSystemPrompt: role.aiSystemPrompt,
    initialInterviewBookingLink: role.initialInterviewBookingLink,
    hodInterviewBookingLink: role.hodInterviewBookingLink,
    postingChannels: setupChannels(role.postingChannels),
    evaluationFieldToggles: role.evaluationFieldToggles || "",
    customEvaluationFields: role.customEvaluationFields || [],
    licenseOrCertificateRequired: role.licenseOrCertificateRequired || "",
    keywordsToLookFor: role.keywordsToLookFor || "",
    minimumYearsOfExperience: role.minimumYearsOfExperience || "",
    transferableSkillsAccepted: role.transferableSkillsAccepted || "",
    salaryOrBudgetRange: role.salaryOrBudgetRange || "",
    earliestAvailabilityRule: role.earliestAvailabilityRule || "",
    interviewBehavior: role.interviewBehavior || "",
    experienceRequired: role.experienceRequired,
    salaryMin: role.salaryMin,
    salaryMax: role.salaryMax,
    noticePeriodRequirement: role.noticePeriodRequirement,
    salaryDisclosureStatus: role.salaryDisclosureStatus || "",
    experienceRequirementStatus: role.experienceRequirementStatus || "",
    licenseRequirementStatus: role.licenseRequirementStatus || "",
    hodInterviewRequired: role.hodInterviewRequired || "",
    finalInterviewVenue: role.finalInterviewVenue || "",
    voiceInterviewAvailabilityMode: role.voiceInterviewAvailabilityMode || "none",
    voiceInterviewSlots: role.voiceInterviewSlots || "",
    voiceInterviewAutoStartDate: role.voiceInterviewAutoStartDate || "",
    voiceInterviewAutoEndDate: role.voiceInterviewAutoEndDate || "",
    voiceInterviewTimezone: role.voiceInterviewTimezone || "Asia/Singapore",
    voiceInterviewSlotsGeneratedAt: role.voiceInterviewSlotsGeneratedAt || "",
    recruitmentSetupStatus: role.recruitmentSetupStatus || "",
    applicationLink: role.applicationLink || "",
  };

  return (
    <AppShell user={user}>
      <main className="container page">
        <div className="hero-row">
          <div>
            <a className="btn btn-secondary portal-back-link roles-back-button" href={`/roles/${encodeURIComponent(role.roleId)}`}>
              Back to Role Details
            </a>
            <h1>Edit Role Request</h1>
            <p>Update the vacancy details and HR screening information before the request moves forward.</p>
          </div>
        </div>
        <RoleRequestForm
          user={{ name: String(user.name ?? ""), email: String(user.email ?? "") }}
          roleId={role.roleId}
          status={role.status}
          initialValues={initialValues}
        />
        <RecruitmentSetupEditor
          roleId={role.roleId}
          status={role.status}
          editable={user.canReviewRole === true}
          updatedAt={role.recruitmentSetupUpdatedAt}
          updatedBy={role.recruitmentSetupUpdatedByName}
          updatedByEmail={role.recruitmentSetupUpdatedByEmail}
          setup={recruitmentSetup}
        />
      </main>
    </AppShell>
  );
}
