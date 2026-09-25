import { interviewErrorResponse, interviewJson, readInterviewRequest } from "@/lib/live-interview-http";
import { recordInterviewConsent } from "@/lib/live-interview-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stores the applicant's consent decision before any camera or microphone request. */
export async function POST(request: Request) {
  const parsed = await readInterviewRequest(request, { rateLimit: 20, bucket: "consent" });
  if ("error" in parsed) return parsed.error;
  const { body, token } = parsed;
  try {
    const session = await recordInterviewConsent({
      rawToken: token,
      agreed: body.agreed === true,
      consentVersion: typeof body.consentVersion === "string" ? body.consentVersion : "",
      recording: body.recording === true,
      camera: body.camera === true,
      microphone: body.microphone === true,
      userAgent: request.headers.get("user-agent") || "",
    });
    return interviewJson({ success: true, status: session.status, consentGiven: session.consentGiven });
  } catch (error) {
    return interviewErrorResponse("Consent", error);
  }
}
