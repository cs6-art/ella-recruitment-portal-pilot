import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { canDecideApplicant } from "@/lib/access-control";
import { interviewInvitationMessage } from "@/lib/bulk-approval";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { sendInterviewInvitation } from "@/lib/recruitment-target-portal";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  kind: z.enum(["voice", "avatar"]),
  comment: z.string().trim().max(5000).optional().default(""),
  // HR confirmed replacing an unused invitation of the other interview type.
  switchType: z.boolean().optional().default(false),
});

/**
 * "Send Phone Interview" / "Send Avatar Interview" for one applicant. Resume
 * screening is optional: an unscreened applicant is approved with
 * "Resume screening skipped by HR" in the history and no screening result.
 * Same HR permission and organization checks as an approval.
 */
export async function POST(request: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user || !canDecideApplicant(user)) return NextResponse.json({ success: false, error: "You are not authorized to review applicants." }, { status: 403 });
  if (!isPostgresRecruitmentTarget()) return NextResponse.json({ success: false, error: "This action is not available." }, { status: 404 });
  const rate = consumeRateLimit(`applicant-interview-invite:${user.email}:${requestClientKey(request)}`, 60, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many interview invitations. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Choose a phone or Live Avatar interview." }, { status: 422 });
  let applicationId = "";
  try { applicationId = decodeURIComponent((await params).applicationId).trim(); } catch { /* invalid reference */ }
  if (!applicationId) return NextResponse.json({ success: false, error: "Applicant not found." }, { status: 404 });

  try {
    const result = await sendInterviewInvitation({ applicationExternalId: applicationId, organizationId: user.organizationId, kind: parsed.data.kind, actor: { name: user.name, email: user.email }, comments: parsed.data.comment, switchType: parsed.data.switchType });
    const message = interviewInvitationMessage(parsed.data.kind, result.outcome, result.activeKind, { canSwitch: result.canSwitch, switched: result.switched });
    if (result.outcome !== "sent") {
      const status = result.outcome === "not_found" ? 404 : result.outcome === "not_allowed_for_role" ? 422 : result.outcome === "failed" ? 500 : result.outcome === "insufficient_credits" ? 402 : 409;
      return NextResponse.json({ success: false, outcome: result.outcome, activeKind: result.activeKind, canSwitch: result.canSwitch === true, error: message }, { status });
    }
    revalidatePath(`/applicants/${encodeURIComponent(applicationId)}`);
    revalidatePath("/applicants");
    revalidatePath("/dashboard");
    return NextResponse.json({ success: true, outcome: result.outcome, switched: result.switched === true, screeningSkipped: result.screeningSkipped === true, message });
  } catch (error) {
    console.error("[API Interview Invitation] POST failed:", error);
    return NextResponse.json({ success: false, error: "The interview invitation could not be sent. Please try again." }, { status: 500 });
  }
}
