import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  recordApplicantDecision,
  type ApplicantDecision,
  type ApplicantDecisionStage,
} from "@/lib/applicant-workflow";
import { canDecideApplicant } from "@/lib/access-control";
import { getPublicAppBaseUrl } from "@/lib/public-url";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

const stages = new Set<ApplicantDecisionStage>(["resume", "voice", "final"]);
const decisions = new Set<ApplicantDecision>(["Approve", "Reject", "Manual Review"]);
const decisionSchema = z.object({
  stage: z.enum(["resume", "voice", "final"]),
  decision: z.enum(["Approve", "Reject", "Manual Review"]),
  comments: z.string().trim().min(1).max(5000),
});

export async function POST(request: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user || !canDecideApplicant(user)) {
    return NextResponse.json({ error: "You are not authorized to review applicants." }, { status: 403 });
  }
  const rate = consumeRateLimit(`applicant-decision:${user.email}:${requestClientKey(request)}`, 60, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many applicant decisions. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  try {
    const body = decisionSchema.parse(await request.json());
    if (!stages.has(body.stage) || !decisions.has(body.decision)) {
      return NextResponse.json({ error: "Choose a valid workflow stage and decision." }, { status: 400 });
    }

    const applicationId = decodeURIComponent((await params).applicationId);
    // Decisions are internal workflow state and remain available in demo mode.
    // Applicant-facing email/call/booking side effects are guarded downstream.
    const result = await recordApplicantDecision(
      applicationId,
      body.stage,
      body.decision,
      { name: user.name, email: user.email },
      body.comments,
      getPublicAppBaseUrl(request),
    );

    // Mark every server-rendered view that reflects applicant workflow totals
    // or status as stale before the client refreshes the detail page.
    revalidatePath(`/applicants/${encodeURIComponent(applicationId)}`);
    revalidatePath("/applicants");
    revalidatePath("/dashboard");

    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to save applicant decision.",
    }, { status: 400 });
  }
}
