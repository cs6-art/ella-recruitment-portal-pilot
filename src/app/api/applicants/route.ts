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
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { invalidateSheetsCache } from "@/lib/sheets-cache";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { targetCreateApplication, targetRoleDetails } from "@/lib/recruitment-target-portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseError(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

export async function POST(request: Request) {
  let storedResume: Awaited<ReturnType<typeof storeResumeFile>> | null = null;
  try {
    // Allow HR to add a new candidate in demo mode; outbound contact and
    // booking safeguards live in the downstream workflows and booking APIs.
    const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
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
    const role = isPostgresRecruitmentTarget() ? await targetRoleDetails(roleId) : await getRoleRequestById(roleId);
    if (!role || !isPublishedRoleForIntake(role)) {
      return responseError("The selected role is not available for manual candidate intake.", 409);
    }

    if (isPostgresRecruitmentTarget()) {
      try {
        await assertCreditsAvailable(1, "cv_analysis", { organizationId: user.organizationId, ownerEmail: user.email });
      } catch (creditError) {
        if (creditError instanceof EllaCreditsError) return responseError("Not enough Ella Credits to screen this candidate.", 402, { code: creditError.code, required: creditError.required, available: creditError.available });
        throw creditError;
      }
      const applicationId = `APP-${crypto.randomUUID()}`;
      if (intake.resumeFile) storedResume = await storeResumeFile(intake.resumeFile);
      const created = await targetCreateApplication({ externalId: applicationId, roleId, candidateName: parsed.data.candidateName, email: parsed.data.email, phone: normalizePreferredMobile(parsed.data.preferredMobile), preferredMobile: normalizePreferredMobile(parsed.data.preferredMobile), applicantCountry: parsed.data.applicantCountry, source: "direct", sourceDetail: "hr_manual", consentAt: new Date().toISOString(), creditOwnerEmail: user.email, organizationId: user.organizationId, resume: storedResume ? { ...storedResume.record, extractedText: storedResume.extractedText } : undefined });
      if (!created.screeningReused) await recordDeduction({ event: "cv_analysis", units: 1, reference: applicationId, idempotencyKey: `cv:${applicationId}`, roleId, actorName: user.name, actorEmail: user.email, organizationId: user.organizationId, note: "Postgres target HR manual intake screening" });
      return NextResponse.json({ success: true, applicationId, roleId, message: "Candidate added successfully.", creditsCharged: created.screeningReused ? 0 : await creditCostFor("cv_analysis") }, { status: 201 });
    }

    const webhookUrl = await getPortalConfigValue("N8N_Candidate_Application_Webhook_URL");
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET;
    if (!webhookUrl || !webhookSecret) {
      return responseError("The candidate application workflow is not configured.", 503);
    }

    // Screening this candidate costs 1 Ella Credit. Refuse before storing the
    // resume or invoking the workflow if the balance can't cover it.
    try {
      await assertCreditsAvailable(1, "cv_analysis", { organizationId: user.organizationId, ownerEmail: user.email });
    } catch (creditError) {
      if (creditError instanceof EllaCreditsError) {
        return responseError("Not enough Ella Credits to screen this candidate. Top up Ella Credits in Settings.", 402, { code: creditError.code, required: creditError.required, available: creditError.available });
      }
      throw creditError;
    }

    // Reapplications are independent records by policy, even when the email
    // and role match an earlier submission.
    const applicationId = `APP-${crypto.randomUUID()}`;
    const submittedAt = new Date().toISOString();
    if (intake.resumeFile) storedResume = await storeResumeFile(intake.resumeFile);
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
    }).catch((error) => console.error("[API Applicants] Could not record credit deduction:", error));

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
