import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { canManagePipeline } from "@/lib/access-control";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { CREDIT_COST, EllaCreditsError, getCreditBalance, placeAvatarInterviewHold, releaseAvatarInterviewHold } from "@/lib/ella-credits";
import { consumeDurableRateLimit } from "@/lib/durable-rate-limit";
import { rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { getRoleRequestById, isPublishedRoleForIntake } from "@/lib/google-sheets";
import { createLiveAvatarSession, isLiveAvatarConfigured } from "@/lib/live-avatar";
import { isRecordingStorageConfigured } from "@/lib/interview-recording-storage";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { finalizeAvatarInterviewStart, getAvatarInterviewContext, releaseAvatarInterviewStart, startAvatarInterview } from "@/lib/internal-recruitment-queries";
import { assertReadyToStart, LiveInterviewError, markInterviewStarted, stopProviderSession } from "@/lib/live-interview-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, unauthenticated endpoint used by the secure, HR-approved candidate
// avatar link. The token branch reloads the role, resume analysis, and question
// from the database; it never trusts candidate-supplied interview content.
export async function POST(request: NextRequest) {
  if (!isLiveAvatarConfigured()) {
    return NextResponse.json(
      { success: false, error: "The Live Avatar interview is not configured yet." },
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
    // Each accepted request can open a paid provider session, so cap attempts per network.
    const rate = await consumeDurableRateLimit(`avatar-session:${requestClientKey(request)}`, 15, 15 * 60 * 1000);
    if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429, headers: rateLimitHeaders(rate) });
    if (!isPostgresRecruitmentTarget()) return NextResponse.json({ success: false, error: "This avatar interview link is not available." }, { status: 404 });
    let sessionCreated = false;
    let heldFor: { organizationId: string; applicationId: string } | null = null;
    const releaseHold = () => heldFor ? releaseAvatarInterviewHold({ ...heldFor, reason: "session_not_started" }) : Promise.resolve();
    try {
      // Consent and the camera/microphone check must be on record before the
      // one-time invitation is consumed.
      try {
        await assertReadyToStart(avatarToken);
      } catch (gateError) {
        if (gateError instanceof LiveInterviewError) return NextResponse.json({ success: false, error: gateError.message, code: gateError.code }, { status: gateError.status });
        throw gateError;
      }
      // Do not consume the invitation or open a provider room unless the
      // private Drive recording path is ready for this interview.
      if (!isRecordingStorageConfigured()) {
        return NextResponse.json({ success: false, error: "Live Avatar interviews are temporarily unavailable because private recording storage is not configured. Please contact the recruitment team.", code: "recording_storage_unavailable" }, { status: 503 });
      }
      // Do not consume the one-time link, or open a paid provider room, for an
      // organization that cannot cover the interview. The message is neutral
      // because the candidate cannot act on it.
      const preview = await getAvatarInterviewContext(avatarToken);
      if (preview) {
        const unavailable = () => NextResponse.json({ success: false, error: "Live Avatar interviews are temporarily unavailable. Please contact the recruitment team.", code: "interview_unavailable" }, { status: 503 });
        try {
          // Reserve the charge now (atomic on the organization wallet) so the
          // organization cannot spend it elsewhere while the interview runs.
          const hold = await placeAvatarInterviewHold({ organizationId: preview.organizationId, applicationId: preview.applicationId, expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) });
          if (hold.supported) heldFor = { organizationId: preview.organizationId, applicationId: preview.applicationId };
          else if ((await getCreditBalance({ organizationId: preview.organizationId, ownerEmail: preview.creditOwnerEmail })).balance < CREDIT_COST.live_avatar_interview) throw new EllaCreditsError(CREDIT_COST.live_avatar_interview, 0);
        } catch (creditError) {
          if (!(creditError instanceof EllaCreditsError)) throw creditError;
          console.error("[API Live Avatar Candidate Session] Blocked: organization has insufficient credits.", { organizationId: preview.organizationId });
          return unavailable();
        }
      }
      const context = await startAvatarInterview(avatarToken);
      if (!context) {
        await releaseHold();
        return NextResponse.json({ success: false, error: "This avatar interview link has already been used, expired, or is no longer available." }, { status: 410 });
      }
      const session = await createLiveAvatarSession({ roleTitle: context.roleTitle, jobDescription: context.roleDescription, candidateName: context.candidateName, resumeSummary: context.resumeSummary, screeningQuestion: context.screeningQuestion, roleRequirements: context.roleRequirements, interviewQuestions: context.interviewQuestions, evaluationFields: context.evaluationFields, avatarSystemPrompt: context.avatarSystemPrompt });
      sessionCreated = true;
      try {
        await finalizeAvatarInterviewStart(avatarToken);
      } catch (finalizeError) {
        console.error("[API Live Avatar Candidate Session] Failed to finalize invitation state:", finalizeError);
      }
      let recordingEnabled = false;
      try {
        const interview = await markInterviewStarted({ rawToken: avatarToken, providerSessionId: session.sessionId });
        recordingEnabled = interview?.recordingStatus === "pending";
        if (!recordingEnabled) {
          await stopProviderSession(session.sessionId);
          await releaseAvatarInterviewStart(avatarToken);
          await releaseHold();
          return NextResponse.json({ success: false, error: "Live Avatar interviews are temporarily unavailable because recording could not be prepared. Please try again or contact the recruitment team.", code: "recording_not_ready" }, { status: 503 });
        }
      } catch (trackError) {
        console.error("[API Live Avatar Candidate Session] Failed to record interview start:", trackError);
        await stopProviderSession(session.sessionId).catch((stopError) => console.error("[API Live Avatar Candidate Session] Failed to stop untracked provider session:", stopError));
        await releaseAvatarInterviewStart(avatarToken).catch((releaseError) => console.error("[API Live Avatar Candidate Session] Failed to release invitation after tracking failure:", releaseError));
        await releaseHold();
        return NextResponse.json({ success: false, error: "Live Avatar interviews are temporarily unavailable because the interview could not be prepared for recording. Please try again.", code: "recording_not_ready" }, { status: 503 });
      }
      return NextResponse.json({ success: true, ...session, recordingEnabled }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (!sessionCreated) {
        await releaseHold();
        try {
          await releaseAvatarInterviewStart(avatarToken);
        } catch (releaseError) {
          console.error("[API Live Avatar Candidate Session] Failed to release invitation after startup failure:", releaseError);
        }
      }
      console.error("[API Live Avatar Candidate Session] POST failed:", error);
      return NextResponse.json({ success: false, error: "Unable to start the avatar interview." }, { status: 502 });
    }
  }

  // Without an invitation token this path starts a paid LiveAvatar session for
  // any published role, so it is limited to signed-in HR reviewers (the
  // resume-screening preview). Candidates always arrive with a token.
  const reviewer = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!reviewer || !canManagePipeline(reviewer)) {
    return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
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
      { success: true, ...session },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[API Live Avatar Session] POST failed:", error);
    return NextResponse.json({ success: false, error: "Unable to start the Live Avatar session." }, { status: 502 });
  }
}


