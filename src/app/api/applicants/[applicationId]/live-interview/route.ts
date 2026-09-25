import { after, NextResponse } from "next/server";

import { authorizeInterviewReviewer } from "@/lib/live-interview-access";
import { getLiveInterviewReview, recoverStaleLiveInterviews } from "@/lib/live-interview-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ applicationId: string }> };

const PROCESSING = new Set(["INTERVIEW_IN_PROGRESS", "INTERVIEW_COMPLETED", "TRANSCRIPTION_PROCESSING", "ANALYSIS_PROCESSING"]);

/** HR review data for the applicant's latest live avatar interview. */
export async function GET(_request: Request, context: RouteContext) {
  const applicationId = decodeURIComponent((await context.params).applicationId);
  const access = await authorizeInterviewReviewer(applicationId);
  if ("response" in access) return access.response;
  try {
    const review = await getLiveInterviewReview(applicationId, access.user.organizationId);
    if (!review) return NextResponse.json({ success: true, review: null }, { headers: { "Cache-Control": "no-store" } });
    // Lazily resume stalled work (expired lease / abandoned tab) after responding.
    if (PROCESSING.has(review.status) || ["pending", "uploading"].includes(review.recording.status)) {
      after(async () => {
        try {
          await recoverStaleLiveInterviews({ sessionId: review.sessionId, limit: 1 });
        } catch (error) {
          console.error("[API Live Interview Review] Lazy recovery failed:", { sessionId: review.sessionId, error });
        }
      });
    }
    return NextResponse.json({ success: true, review }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Live Interview Review] GET failed:", error);
    return NextResponse.json({ success: false, error: "Unable to load the interview review." }, { status: 500 });
  }
}
