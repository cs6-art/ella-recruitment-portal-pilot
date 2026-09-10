import { NextResponse } from "next/server";
import { getRoleRequestById, isPublishedRoleForIntake } from "@/lib/google-sheets";
import { evaluateLiveAvatarTranscript, type LiveAvatarTranscriptTurn } from "@/lib/live-avatar-screening";
const LIVEAVATAR_API_URL = process.env.LIVEAVATAR_API_URL || "https://api.liveavatar.com";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const roleId = typeof body.roleId === "string" ? body.roleId.trim() : "";
  const question = typeof body.screeningQuestion === "string" ? body.screeningQuestion.trim() : "";
  if (!sessionId || !roleId || !question) return NextResponse.json({ success: false, error: "sessionId, roleId, and screeningQuestion are required." }, { status: 422 });
  const apiKey = process.env.LIVEAVATAR_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ success: false, error: "The live avatar interview is not configured yet." }, { status: 503 });
  try {
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
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to process the interview response." }, { status: 502 });
  }
}
