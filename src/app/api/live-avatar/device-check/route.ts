import { interviewErrorResponse, interviewJson, readInterviewRequest } from "@/lib/live-interview-http";
import { recordDeviceCheck } from "@/lib/live-interview-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await readInterviewRequest(request, { rateLimit: 30, bucket: "device" });
  if ("error" in parsed) return parsed.error;
  const { body, token } = parsed;
  try {
    const session = await recordDeviceCheck({ rawToken: token, cameraReady: body.cameraReady === true, microphoneReady: body.microphoneReady === true });
    return interviewJson({ success: true, status: session.status });
  } catch (error) {
    return interviewErrorResponse("Device Check", error);
  }
}
