import { NextRequest, NextResponse } from "next/server";
import { getRoleRequestById, isPublishedRoleForIntake } from "@/lib/google-sheets";
import { createLiveAvatarSession, isLiveAvatarConfigured } from "@/lib/live-avatar";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { startAvatarInterview } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, unauthenticated endpoint used by the secure, HR-approved candidate
// avatar link. The token branch reloads the role, resume analysis, and question
// from the database; it never trusts candidate-supplied interview content.
export async function POST(request: NextRequest) {
  if (!isLiveAvatarConfigured()) {
    return NextResponse.json(
      { success: false, error: "The live avatar interview is not configured yet." },
      { status: 503 },
    );
  }

  let roleId: unknown;
  let candidateName: unknown;
  let resumeSummary: unknown;
  let screeningQuestion: unknown;
  let avatarToken: unknown;
  try {
    const body = await request.json();
    roleId = body?.roleId;
    candidateName = body?.candidateName;
    resumeSummary = body?.resumeSummary;
    screeningQuestion = body?.screeningQuestion;
    avatarToken = body?.avatarToken;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  if (typeof avatarToken === "string" && avatarToken.trim()) {
    if (!isPostgresRecruitmentTarget()) return NextResponse.json({ success: false, error: "This avatar interview link is not available." }, { status: 404 });
    try {
      const context = await startAvatarInterview(avatarToken);
      if (!context) return NextResponse.json({ success: false, error: "This avatar interview link has already been used, expired, or is no longer available." }, { status: 410 });
      const session = await createLiveAvatarSession({ roleTitle: context.roleTitle, jobDescription: context.roleDescription, candidateName: context.candidateName, resumeSummary: context.resumeSummary, screeningQuestion: context.screeningQuestion });
      return NextResponse.json({ success: true, sessionToken: session.sessionToken, sessionId: session.sessionId }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("[API Live Avatar Candidate Session] POST failed:", error);
      return NextResponse.json({ success: false, error: "Unable to start the avatar interview." }, { status: 502 });
    }
  }

  if (typeof roleId !== "string" || !roleId.trim()) {
    return NextResponse.json({ success: false, error: "roleId is required." }, { status: 400 });
  }

  try {
    const role = await getRoleRequestById(roleId);
    if (!role || !isPublishedRoleForIntake(role)) {
      return NextResponse.json({ success: false, error: "This role is not currently accepting applications." }, { status: 404 });
    }

    const session = await createLiveAvatarSession({
      roleTitle: role.jobTitle,
      jobDescription: role.jobDescription || "",
      candidateName: typeof candidateName === "string" ? candidateName : undefined,
      resumeSummary: typeof resumeSummary === "string" ? resumeSummary : undefined,
      screeningQuestion: typeof screeningQuestion === "string" ? screeningQuestion : undefined,
    });

    return NextResponse.json(
      { success: true, sessionToken: session.sessionToken, sessionId: session.sessionId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[API Live Avatar Session] POST failed:", error);
    return NextResponse.json({ success: false, error: "Unable to start the live avatar session." }, { status: 502 });
  }
}


