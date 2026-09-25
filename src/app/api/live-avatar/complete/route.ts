import { after } from "next/server";

import { interviewErrorResponse, interviewJson, readInterviewRequest } from "@/lib/live-interview-http";
import { completeInterviewSession, runLiveInterviewProcessing } from "@/lib/live-interview-store";
import { logInternalError } from "@/lib/safe-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Transcript retrieval + AI analysis run in `after()` within this budget. If
// the function is cut short, the persisted status and lease let the recovery
// cron or the HR review page resume the work.
export const maxDuration = 300;

const STILL_PROCESSING = new Set(["INTERVIEW_COMPLETED", "TRANSCRIPTION_PROCESSING", "ANALYSIS_PROCESSING"]);

/**
 * Saves the finished interview first and responds immediately; transcript and
 * analysis continue in the background. Safe to call more than once.
 */
export async function POST(request: Request) {
  const parsed = await readInterviewRequest(request, { rateLimit: 20, bucket: "complete" });
  if ("error" in parsed) return parsed.error;
  const { body, token } = parsed;
  try {
    const { session, alreadyCompleted } = await completeInterviewSession({
      rawToken: token,
      providerSessionId: typeof body.sessionId === "string" ? body.sessionId.trim() : "",
      transcript: body.transcript,
      integrityEvents: body.integrityEvents,
      interrupted: body.interrupted === true,
    });
    if (STILL_PROCESSING.has(session.status)) {
      after(async () => {
        // A few passes let a transient transcript miss fall back to the
        // browser capture, and wait out short analysis backoffs, within this
        // invocation.
        try {
          await runLiveInterviewProcessing(session.id);
        } catch (error) {
          logInternalError("API Live Interview Complete", error, { sessionId: session.id, stage: "background_processing" });
        }
      });
    }
    return interviewJson({ success: true, saved: true, alreadyCompleted });
  } catch (error) {
    return interviewErrorResponse("Complete", error);
  }
}
