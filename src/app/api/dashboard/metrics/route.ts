import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { filterVisibleApplicants, filterVisibleRoles } from "@/lib/access-control";
import { getApplicants, getApplicantMetrics, getInterviewBookings, type ApplicantSummary, type InterviewBooking } from "@/lib/candidate-applications";
import { calculateDashboardMetrics } from "@/lib/dashboard-metrics";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { getRoleRequests } from "@/lib/google-sheets";
import { listDashboardProcessingFailures, listDashboardRecordingFailures } from "@/lib/live-interview-store";
import { listOverdueFinalInterviews } from "@/lib/internal-recruitment-queries";
import { collectAttentionAlerts } from "@/lib/dashboard-attention";
import { scheduledInstant } from "@/lib/interview-time";
import { targetRecentApplicantSummaries, targetRoleSummaries, targetUpcomingBookings } from "@/lib/recruitment-target-portal";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DashboardAlert = {
  id: string;
  title: string;
  description: string;
  savedMessage: string;
  href: string;
  actionLabel: string;
};

function upcomingInstant(booking: InterviewBooking) {
  try {
    return scheduledInstant(booking.date, booking.startTime || "00:00", booking.timezone || "Asia/Singapore").getTime();
  } catch {
    return 0;
  }
}

function isBooked(booking: InterviewBooking) {
  return booking.status.trim().toLowerCase().replace(/[_-]+/g, " ") === "booked";
}

function createRecentActivity(roleRequests: ReturnType<typeof calculateDashboardMetrics>["recentRequests"] | undefined, applicants: ApplicantSummary[]) {
  const roleActivity = (roleRequests || []).filter((role) => Date.parse(role.createdAt)).map((role) => ({
    id: `role:${role.roleId}`,
    actor: role.requesterName || "A team member",
    action: "created a hiring request",
    subject: role.jobTitle || "Role request",
    occurredAt: role.createdAt,
    href: `/roles/${encodeURIComponent(role.roleId)}`,
  }));
  const applicantActivity = applicants
    .filter((applicant) => !applicant.isHistoricalDemo && Date.parse(applicant.appliedAt))
    .map((applicant) => ({
      id: `application:${applicant.applicationId}`,
      actor: applicant.candidateName || "A candidate",
      action: "submitted an application for",
      subject: applicant.selectedRole || applicant.roleId || "a role",
      occurredAt: applicant.appliedAt,
      href: `/applicants/${encodeURIComponent(applicant.applicationId)}`,
    }));
  return [...roleActivity, ...applicantActivity]
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, 8);
}

export async function GET() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (!user.canCreateRole && !user.canReviewRole && !user.canApproveRole && !user.canReviewDepartmentRole) {
    return NextResponse.json({ success: false, error: "You do not have permission to view dashboard information." }, { status: 403 });
  }

  const postgresTarget = isPostgresRecruitmentTarget();
  const canViewApplicants = user.canReviewRole === true || user.canApproveRole === true;
  const canViewInterviews = user.canReviewRole === true;

  const roleRequestsPromise = postgresTarget ? targetRoleSummaries() : getRoleRequests();
  const applicantMetricsPromise = canViewApplicants ? getApplicantMetrics() : Promise.resolve(undefined);
  const interviewBookingsPromise = canViewInterviews
    ? (postgresTarget ? targetUpcomingBookings(50) : getInterviewBookings())
    : Promise.resolve([] as InterviewBooking[]);
  const recentApplicantsPromise = canViewApplicants
    ? (postgresTarget ? targetRecentApplicantSummaries() : getApplicants())
    : Promise.resolve([] as ApplicantSummary[]);
  const recordingFailuresPromise = canViewInterviews && postgresTarget
    ? listDashboardRecordingFailures(user.organizationId)
    : Promise.resolve([] as Awaited<ReturnType<typeof listDashboardRecordingFailures>>);

  const processingFailuresPromise = canViewInterviews && postgresTarget
    ? listDashboardProcessingFailures(user.organizationId)
    : Promise.resolve([] as Awaited<ReturnType<typeof listDashboardProcessingFailures>>);
  const overdueInterviewsPromise = canViewInterviews && postgresTarget
    ? listOverdueFinalInterviews(user.organizationId)
    : Promise.resolve([] as Awaited<ReturnType<typeof listOverdueFinalInterviews>>);

  const attentionPromise = canViewInterviews && postgresTarget
    ? collectAttentionAlerts(user.organizationId, { ownerEmail: user.email })
    : Promise.resolve([] as Awaited<ReturnType<typeof collectAttentionAlerts>>);

  const [rolesResult, metricsResult, bookingsResult, applicantsResult, recordingsResult, processingResult, overdueResult, attentionResult] = await Promise.allSettled([
    roleRequestsPromise,
    applicantMetricsPromise,
    interviewBookingsPromise,
    recentApplicantsPromise,
    recordingFailuresPromise,
    processingFailuresPromise,
    overdueInterviewsPromise,
    attentionPromise,
  ]);

  const sectionErrors = {
    overview: rolesResult.status === "rejected" || (canViewApplicants && metricsResult.status === "rejected"),
    upcomingInterviews: canViewInterviews && bookingsResult.status === "rejected",
    alerts: canViewInterviews && (bookingsResult.status === "rejected" || recordingsResult.status === "rejected" || processingResult.status === "rejected" || overdueResult.status === "rejected"),
    recentActivity: rolesResult.status === "rejected" && applicantsResult.status === "rejected",
    activityPartial: rolesResult.status === "rejected" || applicantsResult.status === "rejected",
  };

  if (rolesResult.status === "rejected") console.error("[API Dashboard Metrics] role data unavailable:", rolesResult.reason);
  if (metricsResult.status === "rejected") console.error("[API Dashboard Metrics] applicant metrics unavailable:", metricsResult.reason);
  if (bookingsResult.status === "rejected") console.error("[API Dashboard Metrics] interview data unavailable:", bookingsResult.reason);
  if (applicantsResult.status === "rejected") console.error("[API Dashboard Metrics] recent applicant data unavailable:", applicantsResult.reason);
  if (recordingsResult.status === "rejected") console.error("[API Dashboard Metrics] recording alerts unavailable:", recordingsResult.reason);

  const visibleRoles = rolesResult.status === "fulfilled" ? filterVisibleRoles(rolesResult.value, user) : [];
  const roleMetrics = rolesResult.status === "fulfilled" ? calculateDashboardMetrics(visibleRoles) : null;
  const applicantMetrics = metricsResult.status === "fulfilled" ? metricsResult.value : undefined;
  const visibleApplicants = applicantsResult.status === "fulfilled"
    ? filterVisibleApplicants(applicantsResult.value, user)
    : [];
  const rawBookings = bookingsResult.status === "fulfilled" ? bookingsResult.value : [];
  const now = Date.now();
  const futureBookings = rawBookings
    .filter((booking) => isBooked(booking) && upcomingInstant(booking) > now)
    .sort((left, right) => upcomingInstant(left) - upcomingInstant(right));
  const roleTitles = new Map(visibleRoles.map((role) => [role.roleId.toLowerCase(), role.jobTitle]));

  const upcomingInterviews = futureBookings.slice(0, 5).map((booking) => ({
    applicationId: booking.applicationId,
    candidateName: booking.candidateName || "Candidate name not provided",
    roleTitle: roleTitles.get(booking.roleId.toLowerCase()) || booking.roleId || "Role not provided",
    // A candidate may have had a Live Avatar interview before a later
    // face-to-face booking, so the booking's own interview type takes priority.
    interviewType: /final|face.to.face/i.test(booking.interviewType)
      ? "Face-to-Face Interview"
      : booking.interviewMode === "avatar" || /live\s*avatar/i.test(booking.interviewType)
        ? "Live Avatar Interview"
        : "AI Voice Interview",
    date: booking.date,
    startTime: booking.startTime,
    endTime: booking.endTime,
    timezone: booking.timezone || "Time zone not provided",
    status: "Scheduled",
    interviewerName: booking.interviewerName || booking.interviewerEmail || "",
    href: booking.applicationId ? `/applicants/${encodeURIComponent(booking.applicationId)}` : "/bookings",
  }));

  const alerts: DashboardAlert[] = [];
  for (const booking of futureBookings) {
    const applicantHref = booking.applicationId ? `/applicants/${encodeURIComponent(booking.applicationId)}` : "/bookings";
    if (booking.calendarEventStatus.trim().toLowerCase() === "failed" || booking.calendarEventError.trim()) {
      alerts.push({
        id: `calendar:${booking.slotId}`,
        title: `The calendar event for ${booking.candidateName || "a candidate"} could not be created.`,
        description: "The interview booking is saved. Review the booking to resolve its calendar connection.",
        savedMessage: "The interview booking is saved.",
        href: "/bookings",
        actionLabel: "Review interview booking",
      });
    }
    if (/final|face.to.face/i.test(booking.interviewType) && !booking.interviewerName && !booking.interviewerEmail) {
      alerts.push({
        id: `interviewer:${booking.slotId}`,
        title: `The face-to-face interview for ${booking.candidateName || "a candidate"} has no interviewer assigned.`,
        description: "The interview is scheduled. Assign an interviewer before the appointment.",
        savedMessage: "The interview booking is saved.",
        href: applicantHref,
        actionLabel: "Review applicant",
      });
    }
  }
  if (recordingsResult.status === "fulfilled") {
    recordingsResult.value.forEach((recording) => alerts.push({
      id: `recording:${recording.applicationId}:${recording.updatedAt}`,
      title: `The Live Avatar recording for ${recording.candidateName || "a candidate"} could not be uploaded.`,
      description: "The interview was saved, but its recording is unavailable. Review the applicant record for details.",
      savedMessage: "The interview itself was saved.",
      href: `/applicants/${encodeURIComponent(recording.applicationId)}`,
      actionLabel: "Review applicant",
    }));
  }

  if (processingResult.status === "fulfilled") {
    processingResult.value.forEach((failure) => alerts.push({
      id: `processing:${failure.applicationId}:${failure.updatedAt}`,
      title: `The Live Avatar interview for ${failure.candidateName || "a candidate"} could not be analyzed.`,
      description: "The interview was saved, but the transcript or analysis failed. Open the applicant and retry processing.",
      savedMessage: "The interview itself was saved.",
      href: `/applicants/${encodeURIComponent(failure.applicationId)}`,
      actionLabel: "Retry processing",
    }));
  }
  const overdueInterviews = overdueResult.status === "fulfilled" ? overdueResult.value : [];
  overdueInterviews.slice(0, 5).forEach((interview) => alerts.unshift({
    id: `overdue-final:${interview.applicationId}`,
    title: `The face-to-face interview for ${interview.candidateName || "a candidate"} was on ${new Date(interview.endedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} and has no recorded outcome.`,
    description: "HR needs to review the applicant and record whether the interview took place.",
    savedMessage: "The interview booking is saved.",
    href: `/applicants/${encodeURIComponent(interview.applicationId)}`,
    actionLabel: "Review applicant",
  }));

  if (attentionResult.status === "fulfilled") alerts.push(...attentionResult.value);

  const recentActivity = createRecentActivity(roleMetrics?.recentRequests, visibleApplicants);
  return NextResponse.json({
    success: true,
    metrics: {
      ...roleMetrics,
      applicantMetrics,
      upcomingInterviews,
      alerts: alerts.slice(0, 12),
      overdueFinalInterviews: overdueInterviews.length,
      recentActivity,
      sectionErrors,
      lastUpdatedAt: new Date().toISOString(),
    },
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
