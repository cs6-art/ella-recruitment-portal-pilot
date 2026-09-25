import { NextResponse } from "next/server";

import { canDecideApplicant } from "@/lib/access-control";
import { authorizeInterviewReviewer } from "@/lib/live-interview-access";
import { getLiveInterviewReview, retryLiveInterviewProcessing } from "@/lib/live-interview-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ applicationId: string }> };

/** HR-triggered retry of failed/stalled transcript or analysis processing. */
export async function POST(_request: Request, context: RouteContext) {
  const applicationId = decodeURIComponent((await context.params).applicationId);
  const access = await authorizeInterviewReviewer(applicationId);
  if ("response" in access) return access.response;
  if (!canDecideApplicant(access.user)) return NextResponse.json({ success: false, error: "You do not have permission to retry interview processing." }, { status: 403 });
  try {
    const review = await getLiveInterviewReview(applicationId, access.user.organizationId);
    if (!review) return NextResponse.json({ success: false, error: "Interview not found." }, { status: 404 });
    await retryLiveInterviewProcessing(review.sessionId);
    const refreshed = await getLiveInterviewReview(applicationId, access.user.organizationId);
    return NextResponse.json({ success: true, review: refreshed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Live Interview Retry] POST failed:", error);
    return NextResponse.json({ success: false, error: "Unable to retry interview processing." }, { status: 500 });
  }
}
