import { interviewErrorResponse, interviewJson, readInterviewRequest } from "@/lib/live-interview-http";
import { saveInterviewProgress } from "@/lib/live-interview-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Periodic checkpoint: browser-captured transcript and objective session events. */
export async function POST(request: Request) {
  const parsed = await readInterviewRequest(request, { rateLimit: 240, bucket: "progress" });
  if ("error" in parsed) return parsed.error;
  const { body, token } = parsed;
  try {
    const saved = await saveInterviewProgress({ rawToken: token, transcript: body.transcript, integrityEvents: body.integrityEvents });
    return interviewJson({ success: true, ...saved });
  } catch (error) {
    return interviewErrorResponse("Progress", error);
  }
}
