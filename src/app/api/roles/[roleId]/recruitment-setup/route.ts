import { cookies } from "next/headers";
import crypto from "node:crypto";
import { NextResponse } from "next/server";

import { canEditRecruitmentSetup, canUseRecruitmentSetup, canViewRole } from "@/lib/access-control";
import { getFinalInterviewCalendarConfig, getRoleRequestById, updateRoleRequestFields } from "@/lib/google-sheets";
import { invalidateSheetsCache } from "@/lib/sheets-cache";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { evaluationFieldsForSetup, recruitmentSetupSchema } from "@/lib/recruitment-setup-schema";
import { buildNumberedInterviewQuestions } from "@/lib/interview-question-count";
import { getSetupReadiness, setupStatusForAction } from "@/lib/recruitment-setup-readiness";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { getPortalConfig } from "@/lib/portal-config";
import { resolvePublicAppBaseUrl } from "@/lib/public-url";
import { createConfiguredVoiceInterviewSlots } from "@/lib/applicant-workflow";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { targetRoleDetails, targetUpdateRoleFields } from "@/lib/recruitment-target-portal";
import { listRoles, renameRoleExternalId } from "@/lib/internal-recruitment-queries";
import { generateRoleId } from "@/lib/role-id";
import { serializeVoiceInterviewSlots } from "@/lib/voice-interview-availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ roleId: string }> };

export async function POST(request: Request, context: Context) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (!canEditRecruitmentSetup(user)) return NextResponse.json({ success: false, error: "Only HR reviewers can edit recruitment setup." }, { status: 403 });

  const rate = consumeRateLimit(`recruitment-setup:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many setup updates. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  const { roleId: encodedRoleId } = await context.params;
  const roleId = decodeURIComponent(encodedRoleId);
  const role = isPostgresRecruitmentTarget() ? await targetRoleDetails(roleId) : await getRoleRequestById(roleId);
  if (!role || !canViewRole(user, role)) return NextResponse.json({ success: false, error: "Role request not found." }, { status: 404 });

  try {
    const requestBody = await request.json() as Record<string, unknown>;
    const isAutosaveRequest = requestBody.setupAction === "autosave_draft";
    const autosaveCustomFields = Array.isArray(requestBody.customEvaluationFields)
      ? requestBody.customEvaluationFields.filter((field) => typeof field === "object" && field !== null && typeof (field as { key?: unknown }).key === "string" && typeof (field as { label?: unknown }).label === "string" && typeof (field as { description?: unknown }).description === "string" && String((field as { key: string }).key).trim() && String((field as { label: string }).label).trim() && String((field as { description: string }).description).trim()).slice(0, 3)
      : [];
    const parsedSetup = recruitmentSetupSchema.parse(isAutosaveRequest
      ? {
          ...requestBody,
          // Autosave accepts an incomplete editor. The stored role values keep
          // schema parsing safe without allowing placeholders to advance a
          // readiness stage or trigger n8n.
          jobDescription: String(requestBody.jobDescription || role.jobDescription || "Draft in progress"),
          screeningCriteria: String(requestBody.screeningCriteria || role.screeningCriteria || "Draft in progress"),
          customEvaluationFields: autosaveCustomFields,
          initialInterviewBookingLink: /^https?:\/\//i.test(String(requestBody.initialInterviewBookingLink || "")) ? requestBody.initialInterviewBookingLink : "",
          hodInterviewBookingLink: /^https?:\/\//i.test(String(requestBody.hodInterviewBookingLink || "")) ? requestBody.hodInterviewBookingLink : "",
          voiceInterviewAvailabilityMode: ["none", "manual", "automatic"].includes(String(requestBody.voiceInterviewAvailabilityMode)) ? requestBody.voiceInterviewAvailabilityMode : "none",
          voiceInterviewSlots: String(requestBody.voiceInterviewAvailabilityMode) === "manual" ? requestBody.voiceInterviewSlots : [],
        }
      : requestBody);
    const hasField = (key: string) => Object.prototype.hasOwnProperty.call(requestBody, key);
    const hasCustomEvaluationFields = Object.prototype.hasOwnProperty.call(requestBody, "customEvaluationFields");
    // The editor normally sends the complete current setup. Keep the value
    // already stored on the role whenever an older client or an incomplete
    // record sends an empty field, so saving one section cannot erase another.
    const setup = {
      ...parsedSetup,
      screeningCriteria: parsedSetup.screeningCriteria || role.screeningCriteria || "",
      requiredInterviewQuestion1: parsedSetup.requiredInterviewQuestion1 || role.requiredInterviewQuestion1 || "",
      requiredInterviewQuestion2: parsedSetup.requiredInterviewQuestion2 || role.requiredInterviewQuestion2 || "",
      requiredInterviewQuestion3: parsedSetup.requiredInterviewQuestion3 || role.requiredInterviewQuestion3 || "",
      requiredInterviewQuestion4: parsedSetup.requiredInterviewQuestion4 || role.requiredInterviewQuestion4 || "",
      requiredInterviewQuestion5: parsedSetup.requiredInterviewQuestion5 || role.requiredInterviewQuestion5 || "",
      aiSystemPrompt: parsedSetup.aiSystemPrompt || role.aiSystemPrompt || "",
      postingChannels: hasField("postingChannels")
        ? parsedSetup.postingChannels
        : (role.postingChannels || "").split(",").map((channel) => channel.trim()).filter(Boolean),
      licenseOrCertificateRequired: parsedSetup.licenseOrCertificateRequired || role.licenseOrCertificateRequired || "",
      keywordsToLookFor: parsedSetup.keywordsToLookFor || role.keywordsToLookFor || "",
      minimumYearsOfExperience: parsedSetup.minimumYearsOfExperience || role.minimumYearsOfExperience || "",
      transferableSkillsAccepted: parsedSetup.transferableSkillsAccepted || role.transferableSkillsAccepted || "",
      salaryOrBudgetRange: parsedSetup.salaryOrBudgetRange || role.salaryOrBudgetRange || "",
      earliestAvailabilityRule: parsedSetup.earliestAvailabilityRule || role.earliestAvailabilityRule || "",
      evaluationFieldToggles: hasField("evaluationFieldToggles")
        ? parsedSetup.evaluationFieldToggles
        : (role.evaluationFieldToggles || "").split(",").map((field) => field.trim()).filter(Boolean),
      // An explicit empty array means HR removed the custom fields. Only use
      // the stored fallback for older clients that did not send this property.
      customEvaluationFields: hasCustomEvaluationFields
        ? parsedSetup.customEvaluationFields
        : role.customEvaluationFields || [],
      salaryDisclosureStatus: hasField("salaryDisclosureStatus") ? parsedSetup.salaryDisclosureStatus : role.salaryDisclosureStatus || "",
      experienceRequirementStatus: hasField("experienceRequirementStatus") ? parsedSetup.experienceRequirementStatus : role.experienceRequirementStatus || "",
      licenseRequirementStatus: hasField("licenseRequirementStatus") ? parsedSetup.licenseRequirementStatus : role.licenseRequirementStatus || "",
      hodInterviewRequired: hasField("hodInterviewRequired") ? parsedSetup.hodInterviewRequired : role.hodInterviewRequired || "",
      finalInterviewVenue: hasField("finalInterviewVenue") ? parsedSetup.finalInterviewVenue : role.finalInterviewVenue || "",
    };
    const setupAction = setup.setupAction || "save_draft";
    const isAutosaveDraft = setupAction === "autosave_draft";

    // A publish that already landed — a double click, a retried request, or a
    // second click after a slow first response — leaves the role at "Job
    // Posted". Falling through to the status guard below would answer with
    // "Recruitment setup is only available for Approved or Recruitment Setup
    // roles", which reads as a failure even though the publish succeeded.
    // Report the settled state instead of re-running the workflow.
    // Publishing is idempotent. Permit a retry for an already-posted role so
    // a successful n8n write with a lost/empty response can restore setup
    // fields and regenerate its booking slots instead of leaving the role in
    // a partially published state.
    const canRetryPublishedSetup = setupAction === "publish_role" && role.status === "Job Posted";
    if (canRetryPublishedSetup) {
      let publishedRoleId = role.roleId;
      if (isPostgresRecruitmentTarget() && publishedRoleId.startsWith("DRAFT-")) {
        const existingRoles = await listRoles();
        const nextRoleId = generateRoleId(role.jobTitle, existingRoles.map((existingRole) => String(existingRole.externalId)));
        const renamed = await renameRoleExternalId({ currentExternalId: publishedRoleId, nextExternalId: nextRoleId, actorEmail: user.email });
        if (!renamed.renamed) return NextResponse.json({ success: false, error: renamed.error === "role_id_conflict" ? "The generated role ID is already in use. Refresh and try again." : "The published role ID could not be repaired.", code: renamed.error }, { status: renamed.error === "unknown_role" ? 404 : 409 });
        publishedRoleId = nextRoleId;
      }
      invalidateSheetsCache("Role_Requests");
      invalidateSheetsCache("Role_Status_History");
      return NextResponse.json({
        success: true,
        roleId: publishedRoleId,
        status: "Job Posted",
        action: "recruitment_setup_updated",
        recruitmentSetupStatus: role.recruitmentSetupStatus || "Published",
        message: "This role is already published. No further publish action was needed.",
        notificationStatus: "pending",
        notificationError: "",
        published: true,
        validation: { persisted: true, status: "Job Posted" },
      });
    }
    if (!canUseRecruitmentSetup(role.status)) return NextResponse.json({ success: false, error: `Recruitment setup is unavailable while this role is \"${role.status || "Unknown"}\". Refresh the role and try again.` }, { status: 409 });
    const readinessLevel = setupAction === "mark_recruitment_ready" ? "recruitment-ready" : setupAction === "mark_ready_for_publishing" || setupAction === "publish_role" ? "ready-for-publishing" : "draft";
    const readiness = getSetupReadiness(setup, readinessLevel);
    if (!readiness.valid && !isAutosaveDraft) return NextResponse.json({ success: false, code: "RECRUITMENT_SETUP_INCOMPLETE", message: setupAction === "save_draft" ? "Complete the three required draft fields before saving." : "The recruitment setup is not ready for this stage.", missingFields: readiness.missingFields.map((field) => field.key), missingFieldLabels: readiness.missingFields.map((field) => field.label) }, { status: 422 });
    // The staged buttons stay available for HR who want an explicit audit
    // trail, but a setup that already satisfies every ready-for-publishing
    // requirement should not be refused just because the intermediate button
    // was never clicked. Gating on the stored stage left Publish permanently
    // disabled while the checklist read "All required items complete", and
    // publishing then wrote Recruitment_Setup_Status straight to "Published"
    // anyway. The readiness check above is the real gate; this remains as a
    // defensive one.
    if (setupAction === "publish_role" && !readiness.valid) return NextResponse.json({ success: false, code: "RECRUITMENT_SETUP_NOT_READY", message: "Mark the setup as Ready for Publishing before publishing the role." }, { status: 409 });
    const portalConfig = await getPortalConfig();
    const webhookUrl = portalConfig.N8N_Recruitment_Setup_Webhook_URL || portalConfig.N8N_Role_Webhook_URL;
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET;
    const workflowConfigured = Boolean(webhookUrl && webhookSecret);
    if (!workflowConfigured && setupAction !== "save_draft" && !isAutosaveDraft) return NextResponse.json({ success: false, error: "The recruitment setup workflow is not configured. Save can still be used, but publishing requires the workflow." }, { status: 503 });

    const updatedAt = new Date().toISOString();
    const finalInterviewCalendar = await getFinalInterviewCalendarConfig();
    const actionRequestId = setup.actionRequestId || crypto.randomUUID();
    const performerEmail = user.email.trim().toLowerCase();
    const appBaseUrl = await resolvePublicAppBaseUrl(request);
    const applicationLink = appBaseUrl ? `${appBaseUrl}/apply/${encodeURIComponent(role.roleId)}` : `/apply/${encodeURIComponent(role.roleId)}`;
    const nextRecruitmentSetupStatus = isAutosaveDraft ? role.recruitmentSetupStatus || "Draft" : setupStatusForAction(setupAction, role.recruitmentSetupStatus || "Draft");
    // Canonical numbered list (Q1..Qn, blanks dropped) — the exact string used
    // in the resolved Vapi prompt and shown to HR, so answers stay tied to the
    // right question number.
    const initialInterviewQuestions = buildNumberedInterviewQuestions([
      setup.requiredInterviewQuestion1,
      setup.requiredInterviewQuestion2,
      setup.requiredInterviewQuestion3,
      setup.requiredInterviewQuestion4,
      setup.requiredInterviewQuestion5,
    ]);
    const canonicalSetup = {
      ...setup,
      // Keep the nested and legacy top-level status fields in sync. The
      // deployed n8n mapper may read either shape during the migration from
      // the original role-request payload.
      recruitmentSetupStatus: nextRecruitmentSetupStatus,
      // The active n8n workflow still consumes its historical aggregate field;
      // keep it as a compatibility projection of the five canonical questions.
      initialInterviewQuestions,
      // Keep role context available to the workflow, but let HR's structured
      // setup values override the initial role-request defaults.
      jobDescription: role.jobDescription || setup.jobDescription,
      initialInterviewBookingLink: role.initialInterviewBookingLink || setup.initialInterviewBookingLink,
      hodInterviewBookingLink: role.hodInterviewBookingLink || setup.hodInterviewBookingLink,
    };
    const payload = {
      eventType: "recruitment_setup_updated",
      roleId: role.roleId,
      Role_ID: role.roleId,
      Job_Title: role.jobTitle,
      actionRequestId,
      expectedCurrentStatus: role.status,
      setupAction,
      recruitmentSetupStatus: nextRecruitmentSetupStatus,
      targetRoleStatus: setupAction === "publish_role" ? "Job Posted" : role.status === "Approved" ? "Recruitment Setup" : role.status,
      Status: setupAction === "publish_role" ? "Job Posted" : role.status === "Approved" ? "Recruitment Setup" : role.status,
      recruitmentSetup: canonicalSetup,
      Job_Description: role.jobDescription,
      Screening_Criteria: setup.screeningCriteria,
      Initial_Interview_Questions: initialInterviewQuestions.join("\n"),
      Required_Interview_Question_1: setup.requiredInterviewQuestion1,
      Required_Interview_Question_2: setup.requiredInterviewQuestion2,
      Required_Interview_Question_3: setup.requiredInterviewQuestion3,
      Required_Interview_Question_4: setup.requiredInterviewQuestion4,
      Required_Interview_Question_5: setup.requiredInterviewQuestion5,
      AI_System_Prompt: setup.aiSystemPrompt,
      VAPI_Resolved_System_Prompt: setup.resolvedAiSystemPrompt || "",
      // n8n can pass this value to VAPI as the `ella_system_prompt` dynamic
      // variable while keeping VAPI's dashboard system prompt generic.
      ella_system_prompt: setup.resolvedAiSystemPrompt || "",
      Evaluation_Field_Toggles: setup.evaluationFieldToggles.join(","),
      Evaluation_Fields: JSON.stringify(evaluationFieldsForSetup(setup.evaluationFieldToggles, setup.customEvaluationFields)),
      Initial_Interview_Booking_Link: role.initialInterviewBookingLink || setup.initialInterviewBookingLink,
      HOD_Interview_Booking_Link: role.hodInterviewBookingLink || setup.hodInterviewBookingLink,
      Posting_Channels: setup.postingChannels.join(", "),
      Application_Link: applicationLink,
      Posting_Confirmed: setupAction === "publish_role" ? "TRUE" : "FALSE",
      License_or_Certificate_Required: setup.licenseOrCertificateRequired,
      Keywords_to_Look_For: setup.keywordsToLookFor,
      Minimum_Years_of_Experience: setup.minimumYearsOfExperience || "",
      Transferable_Skills_Accepted: setup.transferableSkillsAccepted,
      Salary_or_Budget_Range: setup.salaryOrBudgetRange,
      Earliest_Availability_Rule: setup.earliestAvailabilityRule,
      Experience_Required: role.experienceRequired,
      Salary_Minimum: role.salaryMin,
      Salary_Maximum: role.salaryMax,
      Work_Schedule: role.workSchedule,
      Notice_Period_Requirement: role.noticePeriodRequirement,
      // Legacy columns remain in the n8n contract, but manual final-interview
      // windows are retired in favor of the connected HR Google Calendar.
      HOD_Availability_Dates: "",
      HOD_Availability_Times: "",
      HOD_Availability_Slots: "[]",
      Voice_Interview_Availability_Mode: setup.voiceInterviewAvailabilityMode,
      Voice_Interview_Slots: serializeVoiceInterviewSlots(setup.voiceInterviewSlots),
      Voice_Interview_Auto_Start_Date: setup.voiceInterviewAutoStartDate,
      Voice_Interview_Auto_End_Date: setup.voiceInterviewAutoEndDate,
      Voice_Interview_Timezone: setup.voiceInterviewTimezone,
      Voice_Interview_Slots_Generated_At: setup.voiceInterviewSlotsGeneratedAt,
      HOD_Email: finalInterviewCalendar.email,
      Recruitment_Setup_Status: setupStatusForAction(setupAction, role.recruitmentSetupStatus || "Draft"),
      Salary_Disclosure_Status: setup.salaryDisclosureStatus,
      Experience_Requirement_Status: setup.experienceRequirementStatus,
      License_Requirement_Status: setup.licenseRequirementStatus,
      HOD_Interview_Required: setup.hodInterviewRequired,
      Final_Interview_Venue: setup.finalInterviewVenue,
      Recruitment_Ready_At: setupAction === "mark_recruitment_ready" ? updatedAt : "",
      Recruitment_Ready_By: setupAction === "mark_recruitment_ready" ? user.name : "",
      Ready_For_Publishing_At: setupAction === "mark_ready_for_publishing" ? updatedAt : "",
      Ready_For_Publishing_By: setupAction === "mark_ready_for_publishing" ? user.name : "",
      Posted_At: setupAction === "publish_role" ? updatedAt : "",
      Posted_By: setupAction === "publish_role" ? user.name : "",
      Recruitment_Setup_Updated_At: updatedAt,
      Recruitment_Setup_Updated_By_Name: user.name,
      Recruitment_Setup_Updated_By_Email: performerEmail,
      performedByName: user.name,
      performedByEmail: performerEmail,
      performedByAccessRole: user.accessRole,
      performedByDepartment: user.department,
      comments: setup.comments,
      timestamp: updatedAt,
      History_ID: actionRequestId,
      Changed_At: updatedAt,
      Changed_By_Name: user.name,
      Changed_By_Email: performerEmail,
      Previous_Status: role.status,
      New_Status: setupAction === "publish_role" ? "Job Posted" : role.status === "Approved" ? "Recruitment Setup" : role.status,
      Comments: setup.comments,
      Action_Source: "Role Details Website",
      Action_Request_ID: actionRequestId,
      Action: setupAction === "save_draft" ? "recruitment_setup_draft_saved" : setupAction === "mark_recruitment_ready" ? "recruitment_setup_marked_ready" : setupAction === "mark_ready_for_publishing" ? "recruitment_setup_ready_for_publishing" : "role_job_posted",
      Access_Role: user.accessRole,
      Department: user.department,
      portalUrl: appBaseUrl ? `${appBaseUrl}/roles/${encodeURIComponent(role.roleId)}` : "",
    };
    // Persist the HR-entered setup content directly, not just the voice
    // fields. Previously everything else reached Role_Requests only through
    // the n8n mapper, so a saved draft that the mapper did not carry was gone
    // on the next page load — the editor reloaded from the sheet and showed
    // blank fields. These are the same values sent in the payload below, and
    // n8n writes them again immediately after, so the two stay consistent.
    // Role status transitions remain owned by the workflow.
    const persistedFields: Record<string, string> = {
      Voice_Interview_Availability_Mode: setup.voiceInterviewAvailabilityMode,
      Voice_Interview_Slots: serializeVoiceInterviewSlots(setup.voiceInterviewSlots),
      Voice_Interview_Auto_Start_Date: setup.voiceInterviewAutoStartDate,
      Voice_Interview_Auto_End_Date: setup.voiceInterviewAutoEndDate,
      Voice_Interview_Timezone: setup.voiceInterviewTimezone,
      Screening_Criteria: setup.screeningCriteria,
      Initial_Interview_Questions: initialInterviewQuestions.join("\n"),
      Required_Interview_Question_1: setup.requiredInterviewQuestion1,
      Required_Interview_Question_2: setup.requiredInterviewQuestion2,
      Required_Interview_Question_3: setup.requiredInterviewQuestion3,
      Required_Interview_Question_4: setup.requiredInterviewQuestion4,
      Required_Interview_Question_5: setup.requiredInterviewQuestion5,
      AI_System_Prompt: setup.aiSystemPrompt,
      Evaluation_Field_Toggles: setup.evaluationFieldToggles.join(","),
      Evaluation_Fields: JSON.stringify(evaluationFieldsForSetup(setup.evaluationFieldToggles, setup.customEvaluationFields)),
      Posting_Channels: setup.postingChannels.join(", "),
      License_or_Certificate_Required: setup.licenseOrCertificateRequired,
      Keywords_to_Look_For: setup.keywordsToLookFor,
      Minimum_Years_of_Experience: setup.minimumYearsOfExperience || "",
      Transferable_Skills_Accepted: setup.transferableSkillsAccepted,
      Salary_or_Budget_Range: setup.salaryOrBudgetRange,
      Earliest_Availability_Rule: setup.earliestAvailabilityRule,
      Recruitment_Setup_Status: nextRecruitmentSetupStatus,
      ...(setupAction === "publish_role"
        ? {
            Application_Link: applicationLink,
            Posting_Confirmed: "TRUE",
            Posted_At: updatedAt,
          }
        : {}),
      Salary_Disclosure_Status: setup.salaryDisclosureStatus,
      Experience_Requirement_Status: setup.experienceRequirementStatus,
      License_Requirement_Status: setup.licenseRequirementStatus,
      HOD_Interview_Required: setup.hodInterviewRequired,
      Final_Interview_Venue: setup.finalInterviewVenue,
      ...(isPostgresRecruitmentTarget()
        ? {
            Status: setupAction === "publish_role"
              ? "job_posted"
              : role.status.toLowerCase().replace(/[\s-]+/g, "_") === "approved"
                ? "recruitment_setup"
                : role.status,
            HOD_Email: role.hodEmail || "",
            Posting_Confirmed: setupAction === "publish_role" ? "TRUE" : "FALSE",
            Posted_At: setupAction === "publish_role" ? updatedAt : "",
            Posted_By: setupAction === "publish_role" ? user.name : "",
            Action_Request_ID: actionRequestId,
            Action: setupAction === "save_draft" ? "recruitment_setup_draft_saved" : setupAction === "mark_recruitment_ready" ? "recruitment_setup_marked_ready" : setupAction === "mark_ready_for_publishing" ? "recruitment_setup_ready_for_publishing" : "role_job_posted",
            Comments: setup.comments,
            Latest_Comments: setup.comments,
          }
        : {}),
      Recruitment_Setup_Updated_At: updatedAt,
      Recruitment_Setup_Updated_By_Name: user.name,
       Recruitment_Setup_Updated_By_Email: performerEmail,
    };
    if (isPostgresRecruitmentTarget()) {
      await targetUpdateRoleFields(role.roleId, persistedFields);
    } else {
      await updateRoleRequestFields(role.roleId, persistedFields);
    }
    if (isPostgresRecruitmentTarget()) {
      let voiceSlotWarning = "";
      let voiceSlotsGeneratedAt = setup.voiceInterviewSlotsGeneratedAt || "";
      if (!isAutosaveDraft && setup.voiceInterviewAvailabilityMode !== "none") {
        try {
          const voiceSlots = await createConfiguredVoiceInterviewSlots({
            roleId: role.roleId,
            mode: setup.voiceInterviewAvailabilityMode,
            manualSlots: setup.voiceInterviewSlots,
            autoStartDate: setup.voiceInterviewAutoStartDate,
            autoEndDate: setup.voiceInterviewAutoEndDate,
            timezone: setup.voiceInterviewTimezone,
            targetHiringDate: role.targetHiringDate,
          });
          voiceSlotsGeneratedAt = voiceSlots.created > 0 || voiceSlots.skipped > 0 ? updatedAt : voiceSlotsGeneratedAt;
          await targetUpdateRoleFields(role.roleId, { Voice_Interview_Slots_Generated_At: voiceSlotsGeneratedAt, Last_Updated_By_Email: performerEmail });
        } catch (voiceSlotError) {
          voiceSlotWarning = voiceSlotError instanceof Error ? `Recruitment setup saved, but AI Voice Interview slots could not be generated: ${voiceSlotError.message}` : "Recruitment setup saved, but AI Voice Interview slots could not be generated.";
          console.error("[API Recruitment Setup] Target voice slot generation failed:", voiceSlotError);
        }
      }
      return NextResponse.json({
        success: true,
        roleId: role.roleId,
        status: setupAction === "publish_role" ? "Job Posted" : role.status,
        action: "recruitment_setup_updated",
        recruitmentSetupStatus: nextRecruitmentSetupStatus,
        updatedAt,
        actionRequestId,
        notificationStatus: setupAction === "publish_role" ? "pending" : "",
        notificationError: "",
        message: voiceSlotWarning || "Recruitment setup saved successfully.",
        voiceSlotWarning,
        voiceSlotsGeneratedAt,
        published: setupAction === "publish_role",
        validation: setupAction === "publish_role" ? { persisted: true, status: "Job Posted" } : undefined,
      });
    }
    let result: Record<string, unknown> = {};
    let workflowWarning = "";
    if (workflowConfigured && !isAutosaveDraft) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Number(process.env.N8N_RECRUITMENT_SETUP_TIMEOUT_MS || 45000));
      try {
        const response = await fetch(webhookUrl!, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Webhook-Secret": webhookSecret!, "X-Idempotency-Key": actionRequestId },
          body: JSON.stringify(payload),
          cache: "no-store",
          signal: controller.signal,
        });
        const raw = await response.text();
        try { result = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { /* handled below */ }
        // The workflow may complete its Sheets writes and return an empty
        // 200 response when the Respond to Webhook body is omitted.
        const workflowRejected = !response.ok || (raw.trim() !== "" && result.success !== true);
        if (workflowRejected) {
          console.error("[API Recruitment Setup] n8n rejected update:", response.status, result);
          const workflowMessage = typeof result.message === "string"
            ? result.message
            : typeof result.error === "string"
              ? result.error
              : "The recruitment setup workflow did not confirm the update.";
          if (setupAction !== "save_draft") return NextResponse.json({ success: false, error: workflowMessage }, { status: response.status === 409 ? 409 : 502 });
          workflowWarning = `Changes saved, but the workflow did not confirm its audit update: ${workflowMessage}`;
        }
      } catch (workflowError) {
        if (setupAction !== "save_draft") throw workflowError;
        workflowWarning = "Changes saved. The workflow confirmation timed out, so its audit notification may still be processing.";
        console.warn("[API Recruitment Setup] Draft workflow confirmation failed after direct save:", workflowError);
      } finally {
        clearTimeout(timeout);
      }
    } else if (!isAutosaveDraft) {
      workflowWarning = "Changes saved. The recruitment setup workflow is not configured, so no workflow notification was sent.";
    }
    // Re-apply the canonical optional-field selections after n8n completes.
    // Older workflow mappings can collapse an array to its first item; the
    // dedicated toggle column keeps every checkbox selection durable.
    await updateRoleRequestFields(role.roleId, {
      Evaluation_Field_Toggles: setup.evaluationFieldToggles.join(","),
      Evaluation_Fields: JSON.stringify(evaluationFieldsForSetup(setup.evaluationFieldToggles, setup.customEvaluationFields)),
    });
    // n8n has just written the new Status/Recruitment_Setup_Status outside
    // this process. The editor refetches the role immediately after this
    // response, so any cache entry repopulated during the request would serve
    // the pre-action status and make the UI look like nothing happened until
    // a second manual refresh.
    invalidateSheetsCache("Role_Requests");
    invalidateSheetsCache("Role_Status_History");

    let voiceSlotWarning = "";
    let voiceSlotsGeneratedAt = setup.voiceInterviewSlotsGeneratedAt || "";
    if (!isAutosaveDraft && setup.voiceInterviewAvailabilityMode !== "none") {
      try {
        const voiceSlots = await createConfiguredVoiceInterviewSlots({
          roleId: role.roleId,
          mode: setup.voiceInterviewAvailabilityMode,
          manualSlots: setup.voiceInterviewSlots,
          autoStartDate: setup.voiceInterviewAutoStartDate,
          autoEndDate: setup.voiceInterviewAutoEndDate,
          timezone: setup.voiceInterviewTimezone,
          targetHiringDate: role.targetHiringDate,
        });
        voiceSlotsGeneratedAt = voiceSlots.created > 0 || voiceSlots.skipped > 0 ? updatedAt : voiceSlotsGeneratedAt;
        await updateRoleRequestFields(role.roleId, { Voice_Interview_Slots_Generated_At: voiceSlotsGeneratedAt });
      } catch (voiceSlotError) {
        voiceSlotWarning = voiceSlotError instanceof Error ? `Role published, but AI Voice Interview slots could not be generated: ${voiceSlotError.message}` : "Role published, but AI Voice Interview slots could not be generated.";
        console.error("[API Recruitment Setup] Voice slot generation failed:", voiceSlotError);
      }
    }
    return NextResponse.json({
      success: true,
      roleId: role.roleId,
      status: typeof result.status === "string" ? result.status : setupAction === "publish_role" ? "Job Posted" : role.status,
      action: "recruitment_setup_updated",
      recruitmentSetupStatus: nextRecruitmentSetupStatus,
      updatedAt,
      actionRequestId,
      notificationStatus: typeof result.notificationStatus === "string" ? result.notificationStatus : "not_configured",
      notificationError: typeof result.notificationError === "string" ? result.notificationError : "",
      message: voiceSlotWarning || workflowWarning || "Recruitment setup saved successfully.",
      voiceSlotWarning,
      voiceSlotsGeneratedAt,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") return NextResponse.json({ success: false, error: "Please check the recruitment setup fields." }, { status: 400 });
    console.error("[API Recruitment Setup] POST failed:", error instanceof Error ? { name: error.name, message: error.message } : error);
    return NextResponse.json({ success: false, error: "Unable to save recruitment setup." }, { status: 500 });
  }
}
