import crypto from "node:crypto";
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
import { publicCorsOptionsResponse, withPublicCors } from "@/lib/public-cors";
import { evaluationFieldsForSetup } from "@/lib/recruitment-setup-schema";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { deleteResumeFile, MAX_RESUME_REQUEST_BYTES, storeResumeFile } from "@/lib/resume-files";
import { getResumeScreeningInvitationByToken, markResumeScreeningInvitationUsed } from "@/lib/resume-screening-invite";
import { invalidateSheetsCache } from "@/lib/sheets-cache";

export const runtime = "nodejs";

function responseError(request: Request, error: string, status: number, extra: Record<string, unknown> = {}) {
  return withPublicCors(request, NextResponse.json({ success: false, error, ...extra }, { status }));
}

export async function OPTIONS(request: Request) {
  return publicCorsOptionsResponse(request);
}

export async function POST(request: Request) {
  let storedResume: Awaited<ReturnType<typeof storeResumeFile>> | null = null;
  try {
    // Demo mode still accepts new applications so the complete intake and
    // screening pipeline can be demonstrated. Applicant-facing side effects
    // remain disabled in the downstream contact workflows.
    const rate = consumeRateLimit(`public-application:${requestClientKey(request)}`, 10, 15 * 60 * 1000);
    if (!rate.allowed) return withPublicCors(request, NextResponse.json({ success: false, error: "Too many applications from this network. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) }));
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_RESUME_REQUEST_BYTES) return responseError(request, "Application uploads must be 10 MB or smaller.", 413);

    const intake = await readCandidateIntakeRequest(request);

    // An HR-generated, single-use application link (see the "Resume
    // Screening" tab) carries an inviteToken. When present it is the source
    // of truth for which role the candidate applies to — the client-supplied
    // roleId is ignored so a tampered form field cannot redirect the
    // application to a different role than the one HR invited them for.
    const inviteToken = typeof intake.body.inviteToken === "string" ? intake.body.inviteToken.trim() : "";
    if (!inviteToken) {
      return responseError(request, "A valid application invitation is required.", 401, {
        code: "INVITE_REQUIRED",
        reason: "invalid",
      });
    }
    let invitation: Awaited<ReturnType<typeof getResumeScreeningInvitationByToken>> = null;
    if (inviteToken) {
      invitation = await getResumeScreeningInvitationByToken(inviteToken);
      if (!invitation || !invitation.valid) {
        return responseError(request, "This application link has expired or was already used.", 410, {
          code: "INVITE_INVALID",
          reason: invitation?.reason,
          applicationId: invitation?.applicationId,
        });
      }
      intake.body.roleId = invitation.roleId;
      // The invitation identifies the intended candidate. The page displays
      // these values as a convenience, but the server must remain the source
      // of truth if somebody edits the form before submitting it.
      intake.body.candidateName = invitation.candidateName;
      intake.body.candidateEmail = invitation.candidateEmail;
      intake.body.applicationSource = "HR Invitation";
    }

    const parsed = candidateApplicationSubmissionSchema.safeParse(candidateBodyForValidation(intake.body, intake.resumeFile));

    if (!parsed.success) {
      return responseError(request, "Full name, contact number, role, resume, and consent are required.", 422);
    }

    if (!parsed.data.consent) {
      return responseError(request, "Full name, contact number, role, resume, and consent are required.", 422);
    }

    if (!isPreferredMobileValid(parsed.data.preferredMobile)) {
      return responseError(request, "Contact number must include a valid country code and local number.", 422, { field: "preferredMobile" });
    }

    const roleId = parsed.data.roleId.trim();
    const role = roleId ? await getRoleRequestById(roleId) : null;
    if (!role || !isPublishedRoleForIntake(role)) {
      return responseError(request, "This role is not accepting applications.", 404);
    }

    const webhookUrl = process.env.N8N_CANDIDATE_APPLICATION_WEBHOOK_URL;
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET;
    if (!webhookUrl || !webhookSecret) {
      return responseError(request, "The candidate application workflow is not configured.", 503);
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
      source: invitation ? "HR Invitation Link" : "Public Application Page",
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
      return responseError(request, "The application could not be submitted.", response.status === 409 ? 409 : 502);
    }

    // The invitation is only burned once the application has actually been
    // accepted by the workflow, so a failed submission leaves the link
    // usable for a retry instead of permanently locking the candidate out.
    if (inviteToken) {
      await markResumeScreeningInvitationUsed(inviteToken, applicationId).catch((error) => {
        console.error("[API Public Applications] Could not mark invitation used:", error);
      });
    }

    // The workflow appends to Sheets independently of the portal process.
    // Invalidate the cached list before an HR reviewer opens Applicants.
    invalidateSheetsCache("High_Match_Profile");

    return withPublicCors(request, NextResponse.json({
      success: true,
      applicationId,
      roleId: role.roleId,
      status: "Pending HR Review",
      message: "Application submitted successfully.",
    }, { status: 201 }));
  } catch (error) {
    if (storedResume) await deleteResumeFile(storedResume.record).catch(() => undefined);
    console.error("[API Public Applications] POST failed:", error);
    return responseError(request, error instanceof Error ? error.message : "Unable to submit the application.", 400);
  }
}
