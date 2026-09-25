import { after, NextResponse } from "next/server";

import { canDecideApplicant } from "@/lib/access-control";
import { authorizeInterviewReviewer } from "@/lib/live-interview-access";
import { getLiveInterviewReview, requestLiveInterviewRetry, runLiveInterviewProcessing } from "@/lib/live-interview-store";
import { logInternalError } from "@/lib/safe-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ applicationId: string }> };

/**
 * HR-triggered retry of failed/stalled transcript or analysis processing.
 * Responds at once with the session in its processing state; the work runs
 * after the response and the review page polls for the result. A retry while
 * processing is already running is acknowledged without starting another.
 */
export async function POST(_request: Request, context: RouteContext) {
  const applicationId = decodeURIComponent((await context.params).applicationId);
  const access = await authorizeInterviewReviewer(applicationId);
  if ("response" in access) return access.response;
  if (!canDecideApplicant(access.user)) return NextResponse.json({ success: false, error: "You do not have permission to retry interview analysis." }, { status: 403 });
  try {
    const review = await getLiveInterviewReview(applicationId, access.user.organizationId);
    if (!review) return NextResponse.json({ success: false, error: "Interview not found." }, { status: 404 });
    const { started } = await requestLiveInterviewRetry(review.sessionId);
    if (started) {
      after(async () => {
        try {
          await runLiveInterviewProcessing(review.sessionId);
        } catch (error) {
          logInternalError("API Live Interview Retry", error, { sessionId: review.sessionId, stage: "background_processing" });
        }
      });
    }
    const refreshed = await getLiveInterviewReview(applicationId, access.user.organizationId);
    return NextResponse.json({ success: true, started, review: refreshed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const reference = logInternalError("API Live Interview Retry", error, { applicationId });
    return NextResponse.json({ success: false, error: "The analysis could not be restarted. Please try again in a moment.", reference }, { status: 500 });
  }
}
