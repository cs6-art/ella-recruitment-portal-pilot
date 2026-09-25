import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canViewApplicant } from "@/lib/access-control";
import { getApplicantById } from "@/lib/candidate-applications";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { COOKIE_NAME, verifySessionToken, type SessionUser } from "@/lib/session";

/**
 * Same gate as the applicant profile page: an HR reviewer/approver (or a
 * department reviewer within their department) in the applicant's
 * organization. Unknown or out-of-scope applicants get a 404 so the response
 * never confirms that a record exists elsewhere.
 */
export async function authorizeInterviewReviewer(applicationId: string): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return { response: NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 }) };
  if (user.canReviewRole !== true && user.canApproveRole !== true && user.canReviewDepartmentRole !== true) {
    return { response: NextResponse.json({ success: false, error: "You do not have permission to review interviews." }, { status: 403 }) };
  }
  if (!isPostgresRecruitmentTarget()) return { response: NextResponse.json({ success: false, error: "Interview not found." }, { status: 404 }) };
  // getApplicantById is organization-scoped in the Postgres target.
  const applicant = await getApplicantById(applicationId);
  if (!applicant || !canViewApplicant(user, applicant)) return { response: NextResponse.json({ success: false, error: "Interview not found." }, { status: 404 }) };
  return { user };
}
