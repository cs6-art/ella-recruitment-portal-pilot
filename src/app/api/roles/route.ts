import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { appendRoleRequestDraft, getFinalInterviewCalendarConfig, getRoleRequestById, getRoleRequests, updateRoleRequestFields } from "@/lib/google-sheets";
import { invalidateSheetsCache } from "@/lib/sheets-cache";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { createRole, listRoles, updateRoleDetails } from "@/lib/internal-recruitment-queries";
import { targetRoleSummaries } from "@/lib/recruitment-target-portal";
import { filterVisibleRoles } from "@/lib/access-control";
import { roleRequestSchema } from "@/lib/role-schema";
import { generateRoleId } from "@/lib/role-id";
import { getPortalConfigValue } from "@/lib/portal-config";
import { resolvePublicAppBaseUrl } from "@/lib/public-url";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE } from "@/lib/recruitment-prompt";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function draftText(value: unknown, maxLength = 20000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function draftList(value: unknown, maxItems = 5) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => draftText(item, 1000)).filter(Boolean).slice(0, maxItems);
}

function roleDraftFields(input: Record<string, unknown>, roleId: string, now: string, user: { name: string; email: string; accessRole?: string; department?: string }, hodEmail: string) {
  const setup = input.recruitmentSetupDraft && typeof input.recruitmentSetupDraft === "object"
    ? input.recruitmentSetupDraft as Record<string, unknown>
    : {};
  const questions = draftList(input.aiGeneratedScreeningQuestions);
  const setupQuestions = [1, 2, 3, 4, 5].map((index) => draftText(setup[`requiredInterviewQuestion${index}`], 1000)).filter(Boolean);
  const setupEvaluationFields = Array.isArray(setup.customEvaluationFields) ? setup.customEvaluationFields.slice(0, 3) : [];
  return {
    Role_ID: roleId,
    Submission_ID: roleId,
    Created_At: now,
    Status: "Draft",
    Request_Type: draftText(input.requestType, 50) || "Staff Addition",
    Department: draftText(input.department, 100),
    Job_Title: draftText(input.jobTitle, 150),
    Number_Of_Vacancies: draftText(input.numberOfVacancies, 10) || "1",
    Reason_For_Request: draftText(input.reasonForRequest, 2000),
    Job_Description: draftText(input.jobDescription),
    Replacement_Employee: draftText(input.requestType === "Staff Replacement" ? input.replacementEmployee : "", 150),
    Target_Hiring_Date: draftText(input.targetHiringDate, 30),
    Employment_Type: draftText(input.employmentType, 50) || "Full-Time",
    HOD_Email: hodEmail,
    HOD_Availability_Dates: "",
    HOD_Availability_Times: "",
    HOD_Availability_Slots: "[]",
    Custom_Screening_Question_1: draftText(input.customScreeningQuestion1, 1000),
    Custom_Screening_Question_2: draftText(input.customScreeningQuestion2, 1000),
    AI_Screening_Questions: questions.join("\n"),
    Screening_Criteria: draftText(setup.screeningCriteria, 10000),
    Initial_Interview_Questions: setupQuestions.join("\n"),
    Required_Interview_Question_1: setupQuestions[0] || "",
    Required_Interview_Question_2: setupQuestions[1] || "",
    Required_Interview_Question_3: setupQuestions[2] || "",
    Required_Interview_Question_4: setupQuestions[3] || "",
    Required_Interview_Question_5: setupQuestions[4] || "",
    AI_System_Prompt: draftText(setup.aiSystemPrompt, 30000),
    Evaluation_Field_Toggles: draftList(setup.evaluationFieldToggles, 20).join(","),
    Evaluation_Fields: JSON.stringify(setupEvaluationFields),
    Posting_Channels: draftList(setup.postingChannels, 10).join(", "),
    License_or_Certificate_Required: draftText(setup.licenseOrCertificateRequired, 1000),
    Keywords_to_Look_For: draftText(setup.keywordsToLookFor, 2000),
    Minimum_Years_of_Experience: draftText(setup.minimumYearsOfExperience, 100),
    Transferable_Skills_Accepted: draftText(setup.transferableSkillsAccepted, 3000),
    Salary_or_Budget_Range: draftText(setup.salaryOrBudgetRange, 500),
    Earliest_Availability_Rule: draftText(setup.earliestAvailabilityRule, 1000),
    Recruitment_Setup_Status: "Draft",
    Requester_Name: user.name,
    Requester_Email: user.email,
    Requester_Type: "HR or Management",
    Submitted_By_Name: user.name,
    Submitted_By_Email: user.email,
    Access_Role: user.accessRole || "",
    Submitted_By_Department: user.department || "",
    Last_Updated_At: now,
    Last_Updated_By_Name: user.name,
    Last_Updated_By_Email: user.email,
    Latest_Comments: "Draft autosaved",
    Source: "Role Creation Website",
    Notification_Status: "not_configured",
    Notification_Error: "",
    Posting_Confirmed: "FALSE",
  };
}

const ROLE_WEBHOOK_MAX_ATTEMPTS = 3;
const ROLE_WEBHOOK_TIMEOUT_MS = 15_000;

function isRetryableRoleWebhookStatus(status: number) {
  return status === 429 || status >= 500;
}

async function postRoleRequestWebhook(url: string, secret: string, payload: Record<string, unknown>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < ROLE_WEBHOOK_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ROLE_WEBHOOK_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": secret,
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!isRetryableRoleWebhookStatus(response.status) || attempt === ROLE_WEBHOOK_MAX_ATTEMPTS - 1) return response;

      // Drain a retryable response before the next attempt and respect a
      // server-provided Retry-After value when n8n is rate limiting us.
      await response.text();
      const retryAfterSeconds = Number(response.headers.get("retry-after") || "");
      const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, 5000)
        : Math.min(1000 * (attempt + 1), 5000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      lastError = error;
      if (attempt === ROLE_WEBHOOK_MAX_ATTEMPTS - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * (attempt + 1), 5000)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The role request webhook did not respond.");
}

export async function GET(request: Request) {
  console.log("[API Roles] GET started");

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

    if (
      user.canReviewRole !== true &&
      user.canApproveRole !== true &&
      user.canCreateRole !== true
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "You do not have permission to review role requests.",
        },
        { status: 403 },
      );
    }

    const query = new URL(request.url).searchParams;
    const requestedPage = Math.max(1, Number(query.get("page") || "1") || 1);
    const pageSize = Math.min(50, Math.max(1, Number(query.get("pageSize") || "25") || 25));
    const status = query.get("status")?.trim() || "";
    const department = query.get("department")?.trim().toLowerCase() || "";
    const requester = query.get("requester")?.trim().toLowerCase() || "";
    const search = query.get("search")?.trim().toLowerCase() || "";
    const sort = query.get("sort") || "newest";
    const sourceRoles = isPostgresRecruitmentTarget() ? await targetRoleSummaries() : await getRoleRequests();
    let roles = filterVisibleRoles(sourceRoles, user).filter((role) =>
      (!status || role.status === status) &&
      (!department || role.department.toLowerCase().includes(department)) &&
      (!requester || `${role.requesterName} ${role.requesterEmail}`.toLowerCase().includes(requester)) &&
      (!search || `${role.roleId} ${role.jobTitle}`.toLowerCase().includes(search)),
    );
    roles = [...roles].sort((left, right) => {
      if (sort === "oldest") return Date.parse(left.createdAt) - Date.parse(right.createdAt);
      if (sort === "target") return (left.targetHiringDate || "9999-12-31").localeCompare(right.targetHiringDate || "9999-12-31");
      return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    });
    const total = roles.length;
    const start = (requestedPage - 1) * pageSize;
    roles = roles.slice(start, start + pageSize);

    console.log(
      "[API Roles] Returning role requests:",
      roles.length,
    );

    return NextResponse.json(
      {
        success: true,
        roles,
        pagination: { page: requestedPage, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
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
      "[API Roles] GET error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error: "Unable to load role requests.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
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

    if (user.canCreateRole !== true) {
      return NextResponse.json(
        {
          success: false,
          error:
            "You do not have permission to create role requests.",
        },
        { status: 403 },
      );
    }

    const rate = consumeRateLimit(`role-create:${user.email}:${requestClientKey(request)}`, 20, 15 * 60 * 1000);
    if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many role requests. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

    const sessionEmail = user.email.trim().toLowerCase();
    if (!/^[^\s@]+@mclinkgroup\.com$/i.test(sessionEmail)) {
      return NextResponse.json(
        { success: false, error: "Your authenticated McLink email is not valid." },
        { status: 400 },
      );
    }

    const clientInput = await request.json();
    const finalInterviewCalendar = await getFinalInterviewCalendarConfig();

    // Autosave is deliberately a direct sheet write. It must never call the
    // role-request webhook, because incomplete drafts are not ready for HR
    // review and must not trigger notification or approval automation.
    if (clientInput && typeof clientInput === "object" && clientInput.draft === true) {
      const requestedDraftId = draftText((clientInput as Record<string, unknown>).draftId, 80).replace(/[^a-zA-Z0-9-]/g, "");
      const roleId = `DRAFT-${requestedDraftId || crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const fields = roleDraftFields(clientInput as Record<string, unknown>, roleId, now, {
        name: user.name,
        email: sessionEmail,
        accessRole: user.accessRole,
        department: user.department,
      }, finalInterviewCalendar.email);
      // A draft may be created by one Vercel instance and submitted to
      // another. Bypass the process-local role cache for this write-then-read
      // check so a just-appended draft cannot look missing.
      if (await getRoleRequestById(roleId, { fresh: true })) await updateRoleRequestFields(roleId, fields);
      else await appendRoleRequestDraft(fields);
      return NextResponse.json({ success: true, draft: true, roleId, status: "Draft", message: "Draft saved." }, { status: 201 });
    }
    const input = roleRequestSchema.parse({
      ...clientInput,
      requesterName: user.name,
      requesterEmail: sessionEmail,
      hodEmail: finalInterviewCalendar.email,
      replacementEmployee: clientInput.requestType === "Staff Replacement"
        ? clientInput.replacementEmployee
        : "",
    });

    if (isPostgresRecruitmentTarget()) {
      const submissionId = crypto.randomUUID();
      const roleId = generateRoleId(input.jobTitle, (await listRoles()).map((role) => String(role.externalId)));
      const created = await createRole({
        externalId: roleId, title: input.jobTitle, departmentSnapshot: input.department, requestType: input.requestType,
        vacancies: input.numberOfVacancies, reason: input.reasonForRequest, targetHiringDate: input.targetHiringDate,
        status: "pending_hr_discussion", source: "portal", requesterEmail: sessionEmail, requesterName: user.name,
        actionRequestId: submissionId, actorEmail: sessionEmail, actorName: user.name,
      });
      if (!created.role) return NextResponse.json({ success: false, error: "The role request could not be saved." }, { status: 502 });
      await updateRoleDetails({
        externalId: roleId,
        setup: { jobDescription: input.jobDescription, screeningCriteria: input.recruitmentSetupDraft?.screeningCriteria || "", requiredInterviewQuestion1: input.recruitmentSetupDraft?.requiredInterviewQuestion1 || "", requiredInterviewQuestion2: input.recruitmentSetupDraft?.requiredInterviewQuestion2 || "", requiredInterviewQuestion3: input.recruitmentSetupDraft?.requiredInterviewQuestion3 || "", requiredInterviewQuestion4: input.recruitmentSetupDraft?.requiredInterviewQuestion4 || "", requiredInterviewQuestion5: input.recruitmentSetupDraft?.requiredInterviewQuestion5 || "", postingChannels: input.recruitmentSetupDraft?.postingChannels || [] },
        evaluationFields: input.recruitmentSetupDraft?.customEvaluationFields || [], actorEmail: sessionEmail,
      });
      return NextResponse.json({ success: true, roleId, status: "Pending HR Discussion", message: "Role request submitted successfully." }, { status: 201 });
    }

    const webhookUrl = await getPortalConfigValue("N8N_Role_Webhook_URL");

    const webhookSecret =
      process.env.N8N_WEBHOOK_SECRET;

    const submissionId = crypto.randomUUID();
    const existingRoles = await getRoleRequests();
    const roleId = generateRoleId(
      input.jobTitle,
      existingRoles.map((role) => role.roleId),
    );
    const createdAt = new Date().toISOString();
    const initialStatus = "Pending HR Discussion";
    const performerEmail = user.email.trim().toLowerCase();
    const appBaseUrl = await resolvePublicAppBaseUrl(request);
    // Include the canonical role URL so notification workflows can link
    // recipients directly back to the request in the recruitment portal.
    const portalUrl = appBaseUrl
      ? `${appBaseUrl}/roles/${encodeURIComponent(roleId)}`
      : "";

    // These values are generated by the server. They are deliberately not
    // part of the client form or the request schema.
    const workflowFields = {
      Role_ID: roleId,
      Created_At: createdAt,
      Status: initialStatus,
      Last_Updated_At: createdAt,
      Last_Updated_By_Name: user.name,
      Last_Updated_By_Email: performerEmail,
      Latest_Comments: "",
      Resume_Target_Status: "",
      History_ID: submissionId,
      Changed_At: createdAt,
      Changed_By_Name: user.name,
      Changed_By_Email: performerEmail,
      Previous_Status: "",
      New_Status: initialStatus,
      Comments: "Role request created",
      Action_Source: "Role Creation Website",
      Action_Request_ID: submissionId,
      Action: "role_request_created",
      Access_Role: user.accessRole,
      Department: user.department,
      Notification_Status: "",
      Notification_Error: "",
      Recruitment_Setup_Status: "Draft",
      Salary_Disclosure_Status: "",
      Experience_Requirement_Status: "",
      License_Requirement_Status: "",
      HOD_Interview_Required: "",
      Recruitment_Ready_At: "",
      Recruitment_Ready_By: "",
      Ready_For_Publishing_At: "",
      Ready_For_Publishing_By: "",
      Posted_At: "",
      Posted_By: "",
      Application_Link: "",
      Posting_Confirmed: "FALSE",
    };

    const payload = {
      eventType: "role_request_created",
      submissionId,
      submittedAt: createdAt,
      roleId,
      portalUrl,
      createdAt,
      status: initialStatus,

      // Keep the exact sheet column names in the webhook payload so the n8n
      // workflow can auto-map them without relying on requester input.
      workflowFields,
      ...workflowFields,

      submittedBy: {
        name: user.name,
        email: performerEmail,
        googleSub: user.sub,
      },

      requester: {
        name: user.name,
        email: performerEmail,
        type: "HR or Management",
      },

      role: {
        requestType: input.requestType,
        department: input.department,
        jobTitle: input.jobTitle,
        numberOfVacancies:
          input.numberOfVacancies,
        reasonForRequest:
          input.reasonForRequest,
        jobDescription: input.jobDescription,
        replacementEmployee:
          input.replacementEmployee,
        targetHiringDate:
          input.targetHiringDate,
        hodEmail: finalInterviewCalendar.email,
        hodAvailabilityDates: input.hodAvailabilityDates,
        hodAvailabilityTimes: input.hodAvailabilityTimes,
        hodAvailabilitySlots: input.hodAvailabilitySlots,
        customScreeningQuestion1: input.customScreeningQuestion1,
        customScreeningQuestion2: input.customScreeningQuestion2,
        aiGeneratedScreeningQuestions: input.aiGeneratedScreeningQuestions,
        // Keep the legacy sheet columns explicit and blank. These details are
        // no longer collected during role creation; HR can add them later if
        // they become necessary for a specific role.
        reportingManager: input.reportingManager || "",
        workLocation: input.workLocation || "",
        employmentType: input.employmentType || "Full-Time",
        jobResponsibilities: input.jobResponsibilities || "",
        requiredSkills: input.requiredSkills || "",
        experienceRequired: input.experienceRequired || "",
        educationRequirements: input.educationRequirements || "",
        preferredQualifications: input.preferredQualifications || "",
        roleExpectations: input.roleExpectations || "",
        salaryMin: input.salaryMin ?? "",
        salaryMax: input.salaryMax ?? "",
        workSchedule: input.workSchedule || "",
        noticePeriodRequirement: input.noticePeriodRequirement || "",
        salaryExpectationGuidance: input.salaryExpectationGuidance || "",
      },

      recruitmentSetup: {
        jobDescription: input.recruitmentSetupDraft?.jobDescription || "",
        screeningCriteria: input.recruitmentSetupDraft?.screeningCriteria || "",
        initialInterviewQuestions: [
          input.recruitmentSetupDraft?.requiredInterviewQuestion1,
          input.recruitmentSetupDraft?.requiredInterviewQuestion2,
          input.recruitmentSetupDraft?.requiredInterviewQuestion3,
          input.recruitmentSetupDraft?.requiredInterviewQuestion4,
          input.recruitmentSetupDraft?.requiredInterviewQuestion5,
        ].filter(Boolean),
        requiredInterviewQuestion1: input.recruitmentSetupDraft?.requiredInterviewQuestion1 || "",
        requiredInterviewQuestion2: input.recruitmentSetupDraft?.requiredInterviewQuestion2 || "",
        requiredInterviewQuestion3: input.recruitmentSetupDraft?.requiredInterviewQuestion3 || "",
        requiredInterviewQuestion4: input.recruitmentSetupDraft?.requiredInterviewQuestion4 || "",
        requiredInterviewQuestion5: input.recruitmentSetupDraft?.requiredInterviewQuestion5 || "",
        keywordsToLookFor: input.recruitmentSetupDraft?.keywordsToLookFor || "",
        minimumYearsOfExperience: input.recruitmentSetupDraft?.minimumYearsOfExperience || "",
        transferableSkillsAccepted: input.recruitmentSetupDraft?.transferableSkillsAccepted || "",
        licenseOrCertificateRequired: input.recruitmentSetupDraft?.licenseOrCertificateRequired || "",
        salaryOrBudgetRange: input.recruitmentSetupDraft?.salaryOrBudgetRange || "",
        earliestAvailabilityRule: input.recruitmentSetupDraft?.earliestAvailabilityRule || "",
        evaluationFieldToggles: input.recruitmentSetupDraft?.evaluationFieldToggles || [],
        customEvaluationFields: input.recruitmentSetupDraft?.customEvaluationFields || [],
        aiSystemPrompt: STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE,
        initialInterviewBookingLink: "",
        hodInterviewBookingLink: "",
        postingChannels: input.recruitmentSetupDraft?.postingChannels || [],
        salaryDisclosureStatus: "",
        experienceRequirementStatus: "",
        licenseRequirementStatus: "",
        hodInterviewRequired: "",
        recruitmentSetupStatus: "Draft",
      },

      source: "Role Creation Website",
    };

    const configuredWebhookUrl = webhookUrl.trim();
    const configuredWebhookSecret = webhookSecret?.trim() || "";
    if (!configuredWebhookUrl || !configuredWebhookSecret) {
      return NextResponse.json({ success: false, error: "The n8n role automation is not configured. Contact an administrator." }, { status: 503 });
    }

    // Retry transient n8n failures, including HTTP 429 rate limits, but never
    // report success unless the automation returns a valid response.
    const webhookResponse = await postRoleRequestWebhook(configuredWebhookUrl, configuredWebhookSecret, payload);

    const raw =
      await webhookResponse.text();

    let result: Record<string, unknown> = {};

    try {
      result = raw
        ? JSON.parse(raw)
        : {};
    } catch {
      result = { raw };
    }

    const returnedRoleId =
      typeof result.roleId === "string"
        ? result.roleId
        : typeof result.Role_ID === "string"
          ? result.Role_ID
          : raw.trim() === ""
            ? roleId
            : undefined;
    const returnedStatus =
      typeof result.status === "string"
        ? result.status
        : typeof result.Status === "string"
          ? result.Status
          : raw.trim() === ""
            ? initialStatus
            : undefined;

    if (!webhookResponse.ok) {
      console.error(
        "[API Roles] n8n rejected request:",
        webhookResponse.status,
        result,
      );

      const detail = typeof result.error === "string"
        ? result.error
        : typeof result.message === "string"
          ? result.message
          : `n8n returned HTTP ${webhookResponse.status}`;
      return NextResponse.json({ success: false, error: `Role automation failed: ${detail}` }, { status: 502 });
    }

    if (
      typeof returnedRoleId !== "string" ||
      typeof returnedStatus !== "string" ||
      !returnedRoleId.trim() ||
      returnedStatus !== initialStatus
    ) {
      console.error(
        "[API Roles] n8n returned invalid foundation fields:",
        { returnedRoleId, returnedStatus, roleId, initialStatus },
      );

      return NextResponse.json({ success: false, error: "Role automation returned an incomplete response. The role was not created; please retry." }, { status: 502 });
    }

    // getRoleRequests() above cached the pre-creation snapshot, and n8n has
    // just appended the new row outside that cache. Without this, the
    // redirect to /roles/<id> reads the stale list for the rest of the TTL
    // and renders "Role request not found" until the user refreshes again.
    invalidateSheetsCache("Role_Requests");

    return NextResponse.json(
      {
        success: true,
        // n8n may generate the persisted role ID. Use the ID that was
        // actually written so subsequent detail/status requests address the
        // same row in Role_Requests.
        roleId: returnedRoleId,
        status: initialStatus,
        message:
          result.message ||
          "Role request submitted successfully.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error(
      "[API Roles] POST error:",
      error,
    );

    const detail = error instanceof Error ? error.message.trim() : "";
    return NextResponse.json(
      {
        success: false,
        error: detail || "Role automation failed without a response. Please try again.",
      },
      { status: error instanceof Error && /role automation|webhook|fetch|abort|timeout/i.test(detail) ? 502 : 400 },
    );
  }
}
