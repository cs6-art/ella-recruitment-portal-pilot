import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { filterVisibleApplicants, isDepartmentReviewer } from "@/lib/access-control";
import { getApplicants } from "@/lib/candidate-applications";
import { applicantAppliedTime, type RecentApplicant } from "@/lib/new-applicants";
import { listUnseenApplicants } from "@/lib/applicant-seen";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { targetRecentApplicantSummaries } from "@/lib/recruitment-target-portal";
import { logServerTiming, measureServerOperation } from "@/lib/server-timing";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight feed for the header "new applicants" bell. Returns the newest
 * operational applicants the caller is allowed to see (generated demo history
 * is excluded); the client decides which are unseen from its own watermark.
 */
export async function GET(request: Request) {
  const startedAt = performance.now();
  const timings: Record<string, number> = {};
  let itemCount = 0;
  let timingLogged = false;
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (user.canReviewRole !== true && user.canApproveRole !== true && user.canReviewDepartmentRole !== true) {
    return NextResponse.json({ success: false, error: "Not authorized." }, { status: 403 });
  }

  try {
    if (isPostgresRecruitmentTarget()) {
      // Read state is stored per user on the server (drizzle/0039), so the
      // feed returns only this user's unseen applicants and their total.
      const unseen = await measureServerOperation(timings, "unseenApplicants", () => listUnseenApplicants(user.organizationId, user.email, { department: isDepartmentReviewer(user) ? user.department : "" }));
      itemCount = unseen.applicants.length;
      logServerTiming(new URL(request.url).pathname, startedAt, timings, { dbOperations: 3, itemCount });
      timingLogged = true;
      return NextResponse.json({ success: true, serverReadState: true, total: unseen.total, applicants: unseen.applicants }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const applicants = isPostgresRecruitmentTarget()
      ? await measureServerOperation(timings, "recentApplicants", () => targetRecentApplicantSummaries(isDepartmentReviewer(user) ? user.department : ""))
      : filterVisibleApplicants(await measureServerOperation(timings, "recentApplicants", getApplicants), user);
    itemCount = applicants.length;
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

    logServerTiming(new URL(request.url).pathname, startedAt, timings, { dbOperations: isPostgresRecruitmentTarget() ? 1 : 0, itemCount });
    timingLogged = true;
    return NextResponse.json({ success: true, applicants: recent });
  } finally {
    if (!timingLogged) logServerTiming("/api/applicants/recent", startedAt, timings, { dbOperations: isPostgresRecruitmentTarget() ? 1 : 0, itemCount });
  }
}
