import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  buildCandidateApplicationPayload,
  candidateApplicationSubmissionSchema,
  isPreferredMobileValid,
  normalizePreferredMobile,
  sendCandidateApplicationWebhook,
} from "@/lib/applicant-workflow";
import { candidateBodyForValidation, readCandidateIntakeRequest } from "@/lib/candidate-intake";
import { getRoleRequestById, isPublishedRoleForIntake } from "@/lib/google-sheets";
import { evaluationFieldsForSetup } from "@/lib/recruitment-setup-schema";
import { assertCreditsAvailable, creditCostFor, EllaCreditsError, recordDeduction } from "@/lib/ella-credits";
import { getPortalConfigValue } from "@/lib/portal-config";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { deleteResumeFile, storeResumeFile } from "@/lib/resume-files";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";
import { invalidateSheetsCache } from "@/lib/sheets-cache";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { targetCreateApplication, targetRoleDetails } from "@/lib/recruitment-target-portal";
import { getApplicantMetrics, getApplicantsPage } from "@/lib/candidate-applications";
import { canViewRole, isDepartmentReviewer } from "@/lib/access-control";
import type { ApplicationListFilters } from "@/lib/internal-recruitment-queries";
import { portalDateBoundary } from "@/lib/portal-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseError(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

const stageFilters: Record<string, { stage: string[]; interviewMode?: "voice" | "avatar" | "pending" }> = {
  "Resume Review": { stage: ["resume_review"] },
  "Resume Approved": { stage: ["resume_approved"] },
  "Interview Choice Pending": { stage: ["voice_booking_pending"], interviewMode: "pending" },
  "Voice Interview Booking Pending": { stage: ["voice_booking_pending"], interviewMode: "voice" },
  "Live Avatar Interview Pending": { stage: ["voice_booking_pending"], interviewMode: "avatar" },
  "Voice Interview Scheduled": { stage: ["voice_scheduled"], interviewMode: "voice" },
  "Live Avatar Interview Scheduled": { stage: ["voice_scheduled"], interviewMode: "avatar" },
  "Voice Interview Review": { stage: ["voice_review_pending"], interviewMode: "voice" },
  "Avatar Interview Review": { stage: ["voice_review_pending"], interviewMode: "avatar" },
  "Approved for Face-to-Face Interview": { stage: ["approved_for_final"] },
  "Face-to-Face Interview Scheduled": { stage: ["final_scheduled"] },
  "Face-to-Face Decision Pending": { stage: ["final_decision_pending"] },
  "Passed Final Interview": { stage: ["passed_final"] },
  Rejected: { stage: ["rejected"] },
  Withdrawn: { stage: ["withdrawn"] },
  "Voice Interview": { stage: ["voice_booking_pending", "voice_scheduled", "voice_review_pending"], interviewMode: "voice" },
  "Live Avatar Interview": { stage: ["voice_booking_pending", "voice_scheduled", "voice_review_pending"], interviewMode: "avatar" },
  "Face-to-Face Interview": { stage: ["approved_for_final", "final_scheduled", "final_decision_pending", "passed_final"] },
  Completed: { stage: ["passed_final", "rejected"] },
};

function parsedDate(value: string | null, inclusiveEnd = false) {
  return value ? portalDateBoundary(value, inclusiveEnd) || undefined : undefined;
}

/** Authenticated, tenant-scoped list endpoint; page data and count use identical filters. */
export async function GET(request: Request) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return responseError("Authentication required.", 401);
  if (user.canReviewRole !== true && user.canApproveRole !== true && user.canReviewDepartmentRole !== true) {
    return responseError("Not authorized.", 403);
  }

  const params = new URL(request.url).searchParams;
  const scopeRoleId = params.get("scopeRole")?.trim() || "";
  if (scopeRoleId) {
    const scopedRole = isPostgresRecruitmentTarget()
      ? await targetRoleDetails(scopeRoleId, user.organizationId)
      : await getRoleRequestById(scopeRoleId);
    if (!scopedRole || !canViewRole(user, scopedRole)) return responseError("You do not have access to these applicants.", 403);
  }
  const requestedPage = Number(params.get("page"));
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.trunc(requestedPage) : 1;
  const pageSize = [10, 25, 50, 100].includes(Number(params.get("pageSize"))) ? Number(params.get("pageSize")) : 25;
  const stageLabel = params.get("stage") || "";
  const stage = stageFilters[stageLabel];
  const interview = params.get("interview");
  const interviewMode = stage?.interviewMode || (interview === "Voice Interview" ? "voice" : interview === "Live Avatar Interview" ? "avatar" : interview === "Not selected" ? "pending" : undefined);
  const resume = params.get("resume");
  const interviewStatus = params.get("interviewStatus");
  const sort = params.get("sort");
  const dateFrom = parsedDate(params.get("from"));
  const dateToExclusive = parsedDate(params.get("to"), true);
  const filters: ApplicationListFilters = {
    query: params.get("search") || undefined,
    stage: stage?.stage,
    roleExternalId: scopeRoleId || (params.get("role") && params.get("role") !== "All Roles" ? params.get("role") || undefined : undefined),
    department: isDepartmentReviewer(user) ? user.department : undefined,
    resumeStatus: resume === "Screened" ? "screened" as const : resume === "Awaiting screening" ? "awaiting" as const : undefined,
    interviewMode,
    interviewStatus: ["not_started", "scheduled", "in_progress", "awaiting_review", "review_complete"].includes(interviewStatus || "") ? interviewStatus as "not_started" | "scheduled" | "in_progress" | "awaiting_review" | "review_complete" : undefined,
    dateFrom,
    dateToExclusive,
    sort: sort === "oldest" || sort === "match" ? sort : undefined,
  };

  try {
    const [result, metrics] = await Promise.all([getApplicantsPage({ page, pageSize, filters }), getApplicantMetrics(filters)]);
    return NextResponse.json({ success: true, ...result, metrics, lastUpdatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[API Applicants] list failed:", error);
    return responseError("Applicants could not be refreshed. Please try again.", 500);
  }
}

export async function POST(request: Request) {
  let storedResume: Awaited<ReturnType<typeof storeResumeFile>> | null = null;
  try {
    // Allow HR to add a new candidate in demo mode; outbound contact and
    // booking safeguards live in the downstream workflows and booking APIs.
    const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
    if (!user) return responseError("Authentication required.", 401);
    if (user.canReviewRole !== true) return responseError("Only HR reviewers can add candidates.", 403);

    const rate = consumeRateLimit(`hr-application:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
    if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many candidate submissions. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

    const intake = await readCandidateIntakeRequest(request);
    const parsed = candidateApplicationSubmissionSchema.safeParse(candidateBodyForValidation(intake.body, intake.resumeFile));

    if (!parsed.success) {
      return responseError("Complete the candidate fields before submitting.", 422);
    }

    if (!isPreferredMobileValid(parsed.data.preferredMobile)) {
      return responseError("Contact number must include a valid country code and local number.", 422, { field: "preferredMobile" });
    }

    const roleId = parsed.data.roleId.trim();
    const role = isPostgresRecruitmentTarget() ? await targetRoleDetails(roleId, user.organizationId) : await getRoleRequestById(roleId);
    if (!role || !isPublishedRoleForIntake(role)) {
      return responseError("The selected role is not available for manual candidate intake.", 409);
    }

    if (isPostgresRecruitmentTarget()) {
      try {
        await assertCreditsAvailable(1, "cv_analysis", { organizationId: user.organizationId, ownerEmail: user.email });
      } catch (creditError) {
        if (creditError instanceof EllaCreditsError) return responseError("Not enough Smile Credits to screen this candidate.", 402, { code: creditError.code, required: creditError.required, available: creditError.available });
        throw creditError;
      }
      const applicationId = `APP-${crypto.randomUUID()}`;
      if (intake.resumeFile) storedResume = await storeResumeFile(intake.resumeFile, { organizationId: user.organizationId });
      const created = await targetCreateApplication({ externalId: applicationId, roleId, candidateName: parsed.data.candidateName, email: parsed.data.email, phone: normalizePreferredMobile(parsed.data.preferredMobile), preferredMobile: normalizePreferredMobile(parsed.data.preferredMobile), applicantCountry: parsed.data.applicantCountry, source: "direct", sourceDetail: "hr_manual", consentAt: new Date().toISOString(), creditOwnerEmail: user.email, organizationId: user.organizationId, resume: storedResume ? { ...storedResume.record, extractedText: storedResume.extractedText } : undefined });
      const reused = created.screeningReused === true;
      return NextResponse.json({
        success: true,
        applicationId,
        roleId,
        message: reused ? "Candidate added successfully. An existing CV analysis was reused and 1 credit was deducted." : "Candidate added successfully and queued for CV analysis.",
        screeningQueued: created.screeningQueued === true,
        screeningReused: reused,
        creditsCharged: reused ? await creditCostFor("cv_analysis") : 0,
      }, { status: 201 });
    }

    const webhookUrl = await getPortalConfigValue("N8N_Candidate_Application_Webhook_URL");
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET;
    if (!webhookUrl || !webhookSecret) {
      return responseError("The candidate application workflow is not configured.", 503);
    }

    // Screening this candidate costs 1 Smile Credit. Refuse before storing the
    // resume or invoking the workflow if the balance can't cover it.
    try {
      await assertCreditsAvailable(1, "cv_analysis", { organizationId: user.organizationId, ownerEmail: user.email });
    } catch (creditError) {
      if (creditError instanceof EllaCreditsError) {
        return responseError("Not enough Smile Credits to screen this candidate. Top up Smile Credits in Settings.", 402, { code: creditError.code, required: creditError.required, available: creditError.available });
      }
      throw creditError;
    }

    // Reapplications are independent records by policy, even when the email
    // and role match an earlier submission.
    const applicationId = `APP-${crypto.randomUUID()}`;
    const submittedAt = new Date().toISOString();
    if (intake.resumeFile) storedResume = await storeResumeFile(intake.resumeFile, { organizationId: user.organizationId });
    const payload = buildCandidateApplicationPayload({
      applicationId,
      roleId,
      jobTitle: role.jobTitle,
      department: role.department,
      evaluationFields: evaluationFieldsForSetup(role.evaluationFieldToggles, role.customEvaluationFields),
      source: "HR Manual Intake",
      submittedAt,
      candidate: {
        ...parsed.data,
        resumeText: storedResume?.extractedText || parsed.data.resumeText,
        ...(storedResume ? { resumeFile: storedResume.record } : {}),
        preferredMobile: normalizePreferredMobile(parsed.data.preferredMobile),
      },
    });

    const { response, result } = await sendCandidateApplicationWebhook(webhookUrl, webhookSecret, payload);
    if (!response.ok || result.success !== true) {
      if (storedResume) await deleteResumeFile(storedResume.record).catch(() => undefined);
      return responseError("The application could not be submitted.", response.status === 409 ? 409 : 502);
    }

    // n8n writes the applicant row outside this process. Drop any pre-submit
    // sheet snapshot so the Applicants page immediately sees the new record.
    invalidateSheetsCache("High_Match_Profile");

    await recordDeduction({
        event: "cv_analysis",
        units: 1,
        reference: applicationId,
        idempotencyKey: `cv:${applicationId}`,
        roleId,
        actorName: user.name,
        actorEmail: user.email,
        organizationId: user.organizationId,
        note: "HR manual intake screening",
      });

    return NextResponse.json({
      success: true,
      applicationId,
      roleId,
      message: "Candidate added successfully.",
      creditsCharged: await creditCostFor("cv_analysis"),
    }, { status: 201 });
  } catch (error) {
    if (storedResume) await deleteResumeFile(storedResume.record).catch(() => undefined);
    console.error("[API Applicants] POST failed:", error);
    return responseError("Unable to save the candidate screening. Please try again.", 400);
  }
}
