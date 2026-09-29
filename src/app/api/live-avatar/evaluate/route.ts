import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { canManagePipeline } from "@/lib/access-control";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { getRoleRequestById, isPublishedRoleForIntake } from "@/lib/google-sheets";
import { evaluateLiveAvatarTranscript, type LiveAvatarTranscriptTurn } from "@/lib/live-avatar-screening";
import { completeAvatarInterview, getAvatarInterviewContext } from "@/lib/internal-recruitment-queries";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { publicErrorMessage } from "@/lib/safe-error";
const LIVEAVATAR_API_URL = process.env.LIVEAVATAR_API_URL || "https://api.liveavatar.com";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const roleId = typeof body.roleId === "string" ? body.roleId.trim() : "";
  const question = typeof body.screeningQuestion === "string" ? body.screeningQuestion.trim() : "";
  const avatarToken = typeof body.avatarToken === "string" ? body.avatarToken.trim() : "";
  if (!sessionId || (!avatarToken && (!roleId || !question))) return NextResponse.json({ success: false, error: avatarToken ? "sessionId is required." : "sessionId, roleId, and screeningQuestion are required." }, { status: 422 });
  const apiKey = process.env.LIVEAVATAR_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ success: false, error: "The live avatar interview is not configured yet." }, { status: 503 });
  try {
    if (avatarToken) {
      if (!isPostgresRecruitmentTarget()) return NextResponse.json({ success: false, error: "This avatar interview link is not available." }, { status: 404 });
      const context = await getAvatarInterviewContext(avatarToken, { allowActive: true });
      if (!context) return NextResponse.json({ success: false, error: "This avatar interview link has already been used, expired, or is no longer available." }, { status: 410 });
      const response = await fetch(`${LIVEAVATAR_API_URL}/v1/sessions/${encodeURIComponent(sessionId)}/transcript`, { headers: { "X-API-KEY": apiKey }, cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("LiveAvatar did not return the interview transcript yet.");
      const transcript = Array.isArray(result?.data?.transcript_data) ? result.data.transcript_data as LiveAvatarTranscriptTurn[] : [];
      const evaluation = evaluateLiveAvatarTranscript({ roleTitle: context.roleTitle, roleDescription: context.roleDescription, question: context.screeningQuestion, transcript });
      const completed = await completeAvatarInterview({ rawToken: avatarToken, sessionId, evaluation, transcript });
      if (!completed.completed) return NextResponse.json({ success: false, error: "This avatar interview has already been completed." }, { status: 409 });
      return NextResponse.json({ success: true, evaluation }, { headers: { "Cache-Control": "no-store" } });
    }
    // The tokenless path is the HR preview only; it must not expose provider transcripts to the public.
    const reviewer = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
    if (!reviewer || !canManagePipeline(reviewer)) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
    const role = await getRoleRequestById(roleId);
    if (!role || !isPublishedRoleForIntake(role)) return NextResponse.json({ success: false, error: "This role is not currently accepting applications." }, { status: 404 });
    const response = await fetch(`${LIVEAVATAR_API_URL}/v1/sessions/${encodeURIComponent(sessionId)}/transcript`, { headers: { "X-API-KEY": apiKey }, cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("LiveAvatar did not return the interview transcript yet.");
    const transcript = Array.isArray(result?.data?.transcript_data) ? result.data.transcript_data as LiveAvatarTranscriptTurn[] : [];
    const evaluation = evaluateLiveAvatarTranscript({ roleTitle: role.jobTitle, roleDescription: role.jobDescription || "", question, transcript });
    return NextResponse.json({ success: true, evaluation }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Live Avatar Evaluate] POST failed:", error);
    return NextResponse.json({ success: false, error: publicErrorMessage(error, "Unable to process the interview response.", "API Live Avatar Evaluate") }, { status: 502 });
  }
}
