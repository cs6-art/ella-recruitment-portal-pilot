import { cookies } from "next/headers";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import BookingsList from "@/components/BookingsList";
import PageHeader from "@/components/ui/PageHeader";
import { getActiveBookingLinkRoleIds, getInterviewBookings } from "@/lib/candidate-applications";
import { canManageInterviewAvailability, canManagePipeline } from "@/lib/access-control";
import { getRoleRequests } from "@/lib/google-sheets";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { targetRoleSummaries } from "@/lib/recruitment-target-portal";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

function BookingsLoading() {
  return <main className="container page bookings-page" aria-busy="true">
    <PageHeader className="bookings-header" eyebrow="INTERVIEW OPERATIONS" title="Interview Calendars" description="Loading schedules and availability..." />
    <section className="card" aria-label="Loading interview calendars">
      <div className="empty">Loading interview calendars...</div>
    </section>
  </main>;
}

async function BookingsData() {
  const [bookings, roles, activeBookingLinks] = await Promise.all([getInterviewBookings(), isPostgresRecruitmentTarget() ? targetRoleSummaries() : getRoleRequests(), getActiveBookingLinkRoleIds()]);
  const approvedRoles = await Promise.all(roles
    .filter((role) => canManageInterviewAvailability(role.status))
    .map(async ({ roleId, jobTitle, targetHiringDate, hodEmail, voiceInterviewAvailabilityMode, voiceInterviewSlots, voiceInterviewAutoStartDate, voiceInterviewAutoEndDate, voiceInterviewTimezone, interviewAvailabilityRules }) => ({
      roleId,
      jobTitle,
      targetHiringDate,
      hodEmail,
      voiceInterviewAvailabilityMode,
      voiceInterviewSlots,
      voiceInterviewAutoStartDate,
      voiceInterviewAutoEndDate,
      voiceInterviewTimezone,
      interviewAvailabilityRules,
      hasActiveVoiceBookingLink: activeBookingLinks.voice.includes(roleId.toLowerCase()),
      hasActiveFinalBookingLink: activeBookingLinks.final.includes(roleId.toLowerCase()),
      finalBusyWindows: "[]",
    })));
  return <BookingsList bookings={bookings} roles={approvedRoles} />;
}

export default async function BookingsPage() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");
  if (!canManagePipeline(user)) redirect("/dashboard");
  return <Suspense fallback={<BookingsLoading />}><BookingsData /></Suspense>;
}
