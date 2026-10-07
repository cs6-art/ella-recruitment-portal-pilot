import crypto from "node:crypto";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { canDecideApplicant } from "@/lib/access-control";
import { decisionComment } from "@/lib/applicant-decision-rules";
import { MAX_BULK_APPROVAL, summarizeBulkApproval, type BulkApprovalOutcome } from "@/lib/bulk-approval";
import { getApplication } from "@/lib/internal-recruitment-queries";
import { isManualOverride, readInterviewAutomation } from "@/lib/interview-automation";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { approveForInterview, sendInterviewInvitation } from "@/lib/recruitment-target-portal";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  applicationIds: z.array(z.string().trim().min(1).max(200)).min(1).max(MAX_BULK_APPROVAL),
  comment: z.string().trim().max(2000).optional().default(""),
  // "approve" keeps the screened-only rule; "voice"/"avatar" send that
  // interview and may skip resume screening (recorded in the history).
  action: z.enum(["approve", "voice", "avatar"]).optional().default("approve"),
});

const ALREADY_APPROVED_STAGES = new Set(["resume_approved", "voice_booking_pending"]);
const INTERVIEW_STAGES = new Set(["voice_scheduled", "voice_review_pending", "approved_for_final", "final_scheduled", "final_decision_pending", "passed_final"]);

/**
 * Approve several applicants for interview in one request. Each applicant is
 * processed on its own (one failure never stops the rest), every lookup is
 * limited to the signed-in organization, and each approval is idempotent.
 */
export async function POST(request: Request) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user || !canDecideApplicant(user)) return NextResponse.json({ success: false, error: "You are not authorized to review applicants." }, { status: 403 });
  if (!isPostgresRecruitmentTarget()) return NextResponse.json({ success: false, error: "Bulk approval is not available." }, { status: 404 });
  const rate = consumeRateLimit(`applicant-bulk-approve:${user.email}:${requestClientKey(request)}`, 10, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many bulk approvals. Try again in a few minutes." }, { status: 429, headers: rateLimitHeaders(rate) });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: `Select between 1 and ${MAX_BULK_APPROVAL} applicants.` }, { status: 422 });

  const batchId = crypto.randomUUID();
  const ids = [...new Set(parsed.data.applicationIds)];
  // Same comment rule as a single approval: optional.
  const note = decisionComment("Approve", parsed.data.comment);
  const comments = note.ok ? note.comment : "";
  const action = parsed.data.action;
  const results: { applicationId: string; outcome: BulkApprovalOutcome }[] = [];

  for (const applicationId of ids) {
    let outcome: BulkApprovalOutcome;
    try {
      if (action !== "approve") {
        const sent = await sendInterviewInvitation({ applicationExternalId: applicationId, organizationId: user.organizationId, kind: action, actor: { name: user.name, email: user.email }, comments, base: "bulk" });
        outcome = sent.outcome === "sent" ? "approved" : sent.outcome;
        results.push({ applicationId, outcome });
        continue;
      }
      const row = await getApplication(applicationId);
      const stage = row?.application.currentStage || "";
      if (!row || row.application.organizationId !== user.organizationId) outcome = "not_found";
      else if (row.application.withdrawn || stage === "rejected" || stage === "withdrawn") outcome = "not_eligible";
      else if (ALREADY_APPROVED_STAGES.has(stage)) outcome = "already_approved";
      else if (INTERVIEW_STAGES.has(stage)) outcome = "interview_exists";
      else if (stage !== "resume_review") outcome = "not_eligible";
      else if (!row.screeningResult) outcome = "screening_pending";
      else {
        const override = isManualOverride(readInterviewAutomation(row.roleSetup), row.screeningResult.matchScore);
        const result = await approveForInterview({
          applicationExternalId: applicationId,
          organizationId: user.organizationId,
          mode: override ? "manual_override" : "bulk",
          actor: { name: user.name, email: user.email },
          comments,
          actionRequestId: `bulk-approve:${batchId}:${applicationId}`,
        });
        outcome = result.updated ? "approved"
          : result.error === "screening_required" ? "screening_pending"
          : result.error === "invalid_transition" ? "already_approved"
          : result.error === "unknown_application" ? "not_found"
          : result.error === "insufficient_credits" ? "insufficient_credits"
          : "failed";
      }
    } catch (error) {
      console.error("[API Bulk Approve] Applicant approval failed:", { applicationId, error: error instanceof Error ? error.message : String(error) });
      outcome = "failed";
    }
    results.push({ applicationId, outcome });
  }

  revalidatePath("/applicants");
  revalidatePath("/dashboard");
  const summary = summarizeBulkApproval(results.map((result) => result.outcome), action);
  return NextResponse.json({ success: true, batchId, ...summary, results });
}
