import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { markApplicantSeen } from "@/lib/applicant-seen";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record that the signed-in user opened this applicant, so it stops counting
 * as NEW for them only. Called by the applicant page after it renders (never
 * by link prefetch). Idempotent and limited to the user's organization.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (user.canReviewRole !== true && user.canApproveRole !== true && user.canReviewDepartmentRole !== true) {
    return NextResponse.json({ success: false, error: "Not authorized." }, { status: 403 });
  }
  if (!isPostgresRecruitmentTarget()) return NextResponse.json({ success: true, recorded: false });
  let applicationId = "";
  try { applicationId = decodeURIComponent((await params).applicationId).trim(); } catch { /* invalid reference */ }
  if (!applicationId) return NextResponse.json({ success: false, error: "Applicant not found." }, { status: 404 });
  try {
    const recorded = await markApplicantSeen(user.organizationId, user.email, applicationId);
    if (!recorded) return NextResponse.json({ success: false, error: "Applicant not found." }, { status: 404 });
    return NextResponse.json({ success: true, recorded: true });
  } catch (error) {
    console.error("[API Applicant Seen] POST failed:", error);
    return NextResponse.json({ success: false, error: "Unable to update the new-applicant status." }, { status: 500 });
  }
}
