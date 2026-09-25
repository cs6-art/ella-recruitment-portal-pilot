import { interviewErrorResponse, interviewJson, readInterviewRequest } from "@/lib/live-interview-http";
import { markRecordingFailed } from "@/lib/live-interview-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await readInterviewRequest(request, { rateLimit: 10, bucket: "recording-failed" });
  if ("error" in parsed) return parsed.error;
  const { body, token } = parsed;
  try {
    const recorded = await markRecordingFailed({ rawToken: token, reason: typeof body.reason === "string" ? body.reason : "" });
    return interviewJson({ success: true, recorded });
  } catch (error) {
    return interviewErrorResponse("Recording Failed", error);
  }
}
