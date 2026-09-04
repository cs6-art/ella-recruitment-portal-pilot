import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  getFinalInterviewCalendarConfig,
  deleteRoleRequest,
  getRoleRequestById,
  getRoleStatusHistory,
  updateRoleRequestFields,
  type RoleRequestDetails,
} from "@/lib/google-sheets";
import { canDeleteRoleRequest, canEditRoleRequest, canViewRole } from "@/lib/access-control";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { targetArchiveRole } from "@/lib/recruitment-target-portal";
import { roleRequestSchema } from "@/lib/role-schema";
import {
  COOKIE_NAME,
  verifySessionToken,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    roleId: string;
  }>;
};

function patchText(value: unknown, fallback: string, maxLength = 20000) {
  return value === undefined || value === null ? fallback : String(value).trim().slice(0, maxLength);
}

function patchList(value: unknown, fallback: string, maxItems = 5) {
  if (value === undefined || value === null) return fallback;
  const items = Array.isArray(value) ? value : String(value).split(/[\n,]/);
  return items.map(String).map((item) => item.trim()).filter(Boolean).slice(0, maxItems).join("\n");
}

function roleDraftFieldsForPatch(body: Record<string, unknown>, role: RoleRequestDetails, user: { name: string; email: string }, hodEmail: string, now: string) {
  const setup = body.recruitmentSetupDraft && typeof body.recruitmentSetupDraft === "object"
    ? body.recruitmentSetupDraft as Record<string, unknown>
    : {};
  const setupQuestions = [1, 2, 3, 4, 5].map((index) => patchText(setup[`requiredInterviewQuestion${index}`], role[`requiredInterviewQuestion${index}` as keyof RoleRequestDetails] as string || "", 1000));
  return {
    Request_Type: patchText(body.requestType, role.requestType, 50),
    Department: patchText(body.department, role.department, 100),
    Job_Title: patchText(body.jobTitle, role.jobTitle, 150),
    Number_Of_Vacancies: patchText(body.numberOfVacancies, String(role.numberOfVacancies || 1), 10),
    Reason_For_Request: patchText(body.reasonForRequest, role.reasonForRequest, 2000),
    Job_Description: patchText(body.jobDescription, role.jobDescription),
    Replacement_Employee: patchText(body.requestType === "Staff Replacement" ? body.replacementEmployee : "", role.replacementEmployee, 150),
    Target_Hiring_Date: patchText(body.targetHiringDate, role.targetHiringDate, 30),
    Employment_Type: patchText(body.employmentType, role.employmentType || "Full-Time", 50),
    HOD_Email: hodEmail,
    Custom_Screening_Question_1: patchText(body.customScreeningQuestion1, role.customScreeningQuestion1, 1000),
    Custom_Screening_Question_2: patchText(body.customScreeningQuestion2, role.customScreeningQuestion2, 1000),
    AI_Screening_Questions: patchList(body.aiGeneratedScreeningQuestions, role.aiGeneratedScreeningQuestions, 5),
    Screening_Criteria: patchText(setup.screeningCriteria, role.screeningCriteria, 10000),
    Initial_Interview_Questions: setupQuestions.filter(Boolean).join("\n"),
    Required_Interview_Question_1: setupQuestions[0],
    Required_Interview_Question_2: setupQuestions[1],
    Required_Interview_Question_3: setupQuestions[2],
    Required_Interview_Question_4: setupQuestions[3],
    Required_Interview_Question_5: setupQuestions[4],
    AI_System_Prompt: patchText(setup.aiSystemPrompt, role.aiSystemPrompt, 30000),
    Evaluation_Field_Toggles: patchList(setup.evaluationFieldToggles, role.evaluationFieldToggles || "", 20).replace(/\n/g, ","),
    Evaluation_Fields: JSON.stringify(Array.isArray(setup.customEvaluationFields) ? setup.customEvaluationFields.slice(0, 3) : role.customEvaluationFields || []),
    Posting_Channels: patchList(setup.postingChannels, role.postingChannels, 10).replace(/\n/g, ", "),
    License_or_Certificate_Required: patchText(setup.licenseOrCertificateRequired, role.licenseOrCertificateRequired || "", 1000),
    Keywords_to_Look_For: patchText(setup.keywordsToLookFor, role.keywordsToLookFor || "", 2000),
    Minimum_Years_of_Experience: patchText(setup.minimumYearsOfExperience, role.minimumYearsOfExperience || "", 100),
    Transferable_Skills_Accepted: patchText(setup.transferableSkillsAccepted, role.transferableSkillsAccepted || "", 3000),
    Salary_or_Budget_Range: patchText(setup.salaryOrBudgetRange, role.salaryOrBudgetRange || "", 500),
    Earliest_Availability_Rule: patchText(setup.earliestAvailabilityRule, role.earliestAvailabilityRule || "", 1000),
    Last_Updated_At: now,
    Last_Updated_By_Name: user.name,
    Last_Updated_By_Email: user.email.trim().toLowerCase(),
    Latest_Comments: "Draft autosaved",
  };
}

export async function GET(
  _request: Request,
  context: RouteContext,
) {
  console.log(
    "[API Role Details] GET started",
  );

  try {
    const cookieStore = await cookies();

    const user = verifySessionToken(
      cookieStore.get(COOKIE_NAME)?.value,
    );

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: "Authentication required.",
        },
        { status: 401 },
      );
    }

    const { roleId } = await context.params;

    const role =
      await getRoleRequestById(roleId, { fresh: true });

    if (!role) {
      return NextResponse.json(
        {
          success: false,
          error: "Role request not found.",
        },
        { status: 404 },
      );
    }

    if (!canViewRole(user, role)) {
      return NextResponse.json(
        { success: false, error: "You do not have permission to view this role request." },
        { status: 403 },
      );
    }

    const history = await getRoleStatusHistory(
      role.roleId,
    );

    console.log(
      "[API Role Details] Returning role:",
      role.roleId,
    );

    return NextResponse.json(
      {
        success: true,
        role,
        history,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "[API Role Details] GET failed:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load the role request.",
      },
      { status: 500 },
    );
  }
}

async function getRoleAndUser(roleId: string) {
  const cookieStore = await cookies();
  const user = verifySessionToken(cookieStore.get(COOKIE_NAME)?.value);
  if (!user) return { user: null, role: null, error: NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 }) };

  // Mutations must observe a draft or role written by a preceding request,
  // even when the requests are handled by different app instances.
  const role = await getRoleRequestById(roleId, { fresh: true });
  if (!role) return { user, role: null, error: NextResponse.json({ success: false, error: "Role request not found." }, { status: 404 }) };
  if (!canViewRole(user, role)) return { user, role: null, error: NextResponse.json({ success: false, error: "You do not have permission to manage this role request." }, { status: 403 }) };
  return { user, role, error: null };
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { roleId } = await context.params;
    const access = await getRoleAndUser(roleId);
    if (access.error || !access.user || !access.role) return access.error;
    if (!canEditRoleRequest(access.user, access.role)) {
      return NextResponse.json({ success: false, error: "You do not have permission to edit this role request." }, { status: 403 });
    }

    const body = await request.json() as Record<string, unknown>;
    const finalInterviewCalendar = await getFinalInterviewCalendarConfig();

    // Draft autosaves deliberately bypass the strict submission schema. They
    // update the existing row only and never advance its workflow status.
    if (body.draft === true) {
      const now = new Date().toISOString();
      const fields = roleDraftFieldsForPatch(body, access.role, access.user, finalInterviewCalendar.email, now);
      await updateRoleRequestFields(access.role.roleId, fields);
      return NextResponse.json({ success: true, draft: true, roleId: access.role.roleId, status: access.role.status, message: "Draft saved." });
    }
    const input = roleRequestSchema.parse({
      ...body,
      requesterName: access.role.requesterName || access.user.name,
      requesterEmail: access.role.requesterEmail || access.user.email,
      hodEmail: finalInterviewCalendar.email,
      replacementEmployee: body.requestType === "Staff Replacement" ? body.replacementEmployee : "",
    });
    const setupDraft = body.recruitmentSetupDraft && typeof body.recruitmentSetupDraft === "object"
      ? body.recruitmentSetupDraft as Record<string, unknown>
      : {};
    const setupText = (key: string, fallback: string) => {
      const value = setupDraft[key];
      return typeof value === "string" && value.trim() ? value.trim() : fallback;
    };
    const setupList = (key: string, fallback: string) => {
      const value = setupDraft[key];
      const list = Array.isArray(value)
        ? value.map(String).map((item) => item.trim()).filter(Boolean)
        : typeof value === "string"
          ? value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
          : [];
      return (list.length > 0 ? list : fallback.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)).join(", ");
    };
    const preservedSetupFields = {
      Screening_Criteria: setupText("screeningCriteria", access.role.screeningCriteria),
      Initial_Interview_Questions: [
        setupText("requiredInterviewQuestion1", access.role.requiredInterviewQuestion1 || ""),
        setupText("requiredInterviewQuestion2", access.role.requiredInterviewQuestion2 || ""),
        setupText("requiredInterviewQuestion3", access.role.requiredInterviewQuestion3 || ""),
        setupText("requiredInterviewQuestion4", access.role.requiredInterviewQuestion4 || ""),
        setupText("requiredInterviewQuestion5", access.role.requiredInterviewQuestion5 || ""),
      ].filter(Boolean).join("\n"),
      Required_Interview_Question_1: setupText("requiredInterviewQuestion1", access.role.requiredInterviewQuestion1 || ""),
      Required_Interview_Question_2: setupText("requiredInterviewQuestion2", access.role.requiredInterviewQuestion2 || ""),
      Required_Interview_Question_3: setupText("requiredInterviewQuestion3", access.role.requiredInterviewQuestion3 || ""),
      Required_Interview_Question_4: setupText("requiredInterviewQuestion4", access.role.requiredInterviewQuestion4 || ""),
      Required_Interview_Question_5: setupText("requiredInterviewQuestion5", access.role.requiredInterviewQuestion5 || ""),
      AI_System_Prompt: access.role.aiSystemPrompt,
      Posting_Channels: setupList("postingChannels", access.role.postingChannels),
      License_or_Certificate_Required: setupText("licenseOrCertificateRequired", access.role.licenseOrCertificateRequired || ""),
      Keywords_to_Look_For: setupText("keywordsToLookFor", access.role.keywordsToLookFor || ""),
      Minimum_Years_of_Experience: setupText("minimumYearsOfExperience", access.role.minimumYearsOfExperience || ""),
      Transferable_Skills_Accepted: setupText("transferableSkillsAccepted", access.role.transferableSkillsAccepted || ""),
      Salary_or_Budget_Range: setupText("salaryOrBudgetRange", access.role.salaryOrBudgetRange || ""),
      Earliest_Availability_Rule: setupText("earliestAvailabilityRule", access.role.earliestAvailabilityRule || ""),
    };
    const updatedAt = new Date().toISOString();

    await updateRoleRequestFields(access.role.roleId, {
      Request_Type: input.requestType,
      Department: input.department,
      Job_Title: input.jobTitle,
      Employment_Type: input.employmentType,
      Number_Of_Vacancies: String(input.numberOfVacancies),
      Reason_For_Request: input.reasonForRequest,
      Job_Description: input.jobDescription,
      Replacement_Employee: input.replacementEmployee,
      Target_Hiring_Date: input.targetHiringDate,
      HOD_Email: input.hodEmail,
      HOD_Availability_Dates: input.hodAvailabilityDates,
      HOD_Availability_Times: input.hodAvailabilityTimes,
      HOD_Availability_Slots: JSON.stringify(input.hodAvailabilitySlots),
      Custom_Screening_Question_1: input.customScreeningQuestion1,
      Custom_Screening_Question_2: input.customScreeningQuestion2,
      AI_Screening_Questions: input.aiGeneratedScreeningQuestions.join("\n"),
      Last_Updated_At: updatedAt,
      Last_Updated_By_Name: access.user.name,
      Last_Updated_By_Email: access.user.email,
      ...preservedSetupFields,
    });

    return NextResponse.json({ success: true, roleId: access.role.roleId, status: access.role.status, message: "Role request updated successfully." });
  } catch (error) {
    console.error("[API Role Details] PATCH failed:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to update the role request." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { roleId } = await context.params;
    const access = await getRoleAndUser(roleId);
    if (access.error || !access.user || !access.role) return access.error;
    if (!canDeleteRoleRequest(access.user, access.role)) {
      return NextResponse.json({ success: false, error: "You do not have permission to delete this role request." }, { status: 403 });
    }

    if (isPostgresRecruitmentTarget()) {
      const result = await targetArchiveRole(access.role.roleId, { email: access.user.email, name: access.user.name });
      if (!result) return NextResponse.json({ success: false, error: "Role request not found." }, { status: 404 });
    } else {
      await deleteRoleRequest(access.role.roleId);
    }
    return NextResponse.json({ success: true, roleId: access.role.roleId, message: "Role request deleted successfully." });
  } catch (error) {
    console.error("[API Role Details] DELETE failed:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to delete the role request." }, { status: 400 });
  }
}
