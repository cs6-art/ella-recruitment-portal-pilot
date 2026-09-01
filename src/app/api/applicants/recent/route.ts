import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { filterVisibleApplicants } from "@/lib/access-control";
import { getApplicants } from "@/lib/candidate-applications";
import { applicantAppliedTime, type RecentApplicant } from "@/lib/new-applicants";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight feed for the header "new applicants" bell. Returns the newest
 * operational applicants the caller is allowed to see (generated demo history
 * is excluded); the client decides which are unseen from its own watermark.
 */
export async function GET() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (user.canReviewRole !== true && user.canApproveRole !== true && user.canReviewDepartmentRole !== true) {
    return NextResponse.json({ success: false, error: "Not authorized." }, { status: 403 });
  }

  const applicants = filterVisibleApplicants(await getApplicants(), user);
  const recent: RecentApplicant[] = applicants
    .filter((applicant) => !applicant.isHistoricalDemo)
    .sort((left, right) =>
      applicantAppliedTime(right.appliedAt, right.applicationId) - applicantAppliedTime(left.appliedAt, left.applicationId))
    .slice(0, 50)
    .map((applicant) => ({
      applicationId: applicant.applicationId,
      candidateName: applicant.candidateName,
      selectedRole: applicant.selectedRole,
      appliedAt: applicant.appliedAt,
    }));

  return NextResponse.json({ success: true, applicants: recent });
}
