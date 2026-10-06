import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { markAllApplicantsSeen } from "@/lib/applicant-seen";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Mark all as read" for new applicants. Affects only the signed-in user. */
export async function POST() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (user.canReviewRole !== true && user.canApproveRole !== true && user.canReviewDepartmentRole !== true) {
    return NextResponse.json({ success: false, error: "Not authorized." }, { status: 403 });
  }
  if (!isPostgresRecruitmentTarget()) return NextResponse.json({ success: true, recorded: false });
  try {
    const clearedAt = await markAllApplicantsSeen(user.organizationId, user.email);
    return NextResponse.json({ success: true, recorded: true, clearedAt: clearedAt.toISOString() });
  } catch (error) {
    console.error("[API Applicants Read All] POST failed:", error);
    return NextResponse.json({ success: false, error: "Unable to mark applicants as read." }, { status: 500 });
  }
}
