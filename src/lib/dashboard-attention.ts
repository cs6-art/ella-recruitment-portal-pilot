import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { applicationStatusHistory, applications, bulkScreeningQueueItems, interviewSlots, oauthConnections, roles } from "@/db/schema-recruitment";
import { CREDIT_COST, getCreditBalance } from "@/lib/ella-credits";

export type AttentionAlert = {
  id: string;
  title: string;
  description: string;
  savedMessage: string;
  href: string;
  actionLabel: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Days a candidate may sit in a waiting stage before HR is nudged to follow up. */
export const STALLED_APPLICANT_DAYS = 5;
/** Days an approved role may wait for recruitment setup before HR is reminded. */
export const STALLED_ROLE_DAYS = 3;

const count = sql<number>`count(*)::int`;

async function countOf(query: PromiseLike<{ n: number }[]>) {
  const [row] = await query;
  return row?.n ?? 0;
}

function plural(value: number, singular: string, pluralForm: string) {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

/**
 * Organization-scoped issues HR can act on that no single stage list surfaces:
 * work that has stalled, missed outcomes, and setup problems. Every check is
 * independent, so one failing query never hides the others.
 */
export async function collectAttentionAlerts(organizationId: string, options: { ownerEmail?: string; now?: Date } = {}): Promise<AttentionAlert[]> {
  const org = organizationId.trim();
  const now = options.now ?? new Date();
  const db = getDb();
  const alerts: AttentionAlert[] = [];
  const n = { n: count };
  const stalledCutoff = new Date(now.getTime() - STALLED_APPLICANT_DAYS * DAY_MS);
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

  const checks: Array<() => Promise<void>> = [
    // 1. Candidates waiting on someone for days: an unused invitation, an unbooked interview, no follow-up.
    async () => {
      const stalled = await countOf(db.select(n).from(applications).where(and(
        eq(applications.organizationId, org),
        eq(applications.withdrawn, false),
        inArray(applications.currentStage, ["resume_approved", "voice_booking_pending", "voice_scheduled", "approved_for_final"]),
        lt(applications.updatedAt, stalledCutoff),
      )));
      if (stalled > 0) alerts.push({
        id: "stalled-applicants",
        title: `${plural(stalled, "applicant has", "applicants have")} not moved in ${STALLED_APPLICANT_DAYS}+ days.`,
        description: "They are waiting to choose or attend an interview. Check whether their invitation was used, or follow up.",
        savedMessage: "Their records are saved.",
        href: "/applicants",
        actionLabel: "Review applicants",
      });
    },
    // 2. A call interview time that passed with no result or no-show recorded.
    async () => {
      const missed = await countOf(db.select(n).from(interviewSlots)
        .innerJoin(applications, eq(applications.id, interviewSlots.applicationId))
        .where(and(
          eq(interviewSlots.organizationId, org),
          eq(interviewSlots.interviewType, "voice"),
          eq(interviewSlots.status, "booked"),
          eq(applications.currentStage, "voice_scheduled"),
          eq(applications.withdrawn, false),
          lt(interviewSlots.endsAt, dayAgo),
        )));
      if (missed > 0) alerts.push({
        id: "voice-outcome-missing",
        title: `${plural(missed, "call interview was", "call interviews were")} scheduled for a past time with no outcome.`,
        description: "No result came back. Mark it as a no-show or ask the candidate to reschedule.",
        savedMessage: "The bookings are saved.",
        href: "/bookings",
        actionLabel: "Review bookings",
      });
    },
    // 3. Not enough Smile Credits for the next interview.
    async () => {
      const { balance } = await getCreditBalance({ organizationId: org, ownerEmail: options.ownerEmail });
      if (balance < CREDIT_COST.live_avatar_interview) alerts.push({
        id: "credits-low",
        title: balance <= 0 ? "Your organization has no Smile Credits left." : `Only ${balance} Smile Credits are left.`,
        description: `A Live Avatar interview needs ${CREDIT_COST.live_avatar_interview} credits. Screening and interviews pause when credits run out.`,
        savedMessage: "Nothing has been lost.",
        href: "/credits",
        actionLabel: "Top up credits",
      });
    },
    // 4. No HR Google Calendar, so face-to-face interviews cannot be booked.
    async () => {
      const connected = await countOf(db.select(n).from(oauthConnections).where(and(eq(oauthConnections.organizationId, org), eq(oauthConnections.provider, "google_calendar"))));
      if (connected === 0) alerts.push({
        id: "calendar-disconnected",
        title: "No HR Google Calendar is connected.",
        description: "Face-to-face interviews cannot be offered to candidates until a calendar is connected.",
        savedMessage: "Nothing has been lost.",
        href: "/settings",
        actionLabel: "Connect calendar",
      });
    },
    // 5. Uploaded resumes that could not be screened.
    async () => {
      const failed = await countOf(db.select(n).from(bulkScreeningQueueItems).where(and(
        eq(bulkScreeningQueueItems.organizationId, org),
        eq(bulkScreeningQueueItems.status, "failed"),
        gte(bulkScreeningQueueItems.updatedAt, weekAgo),
      )));
      if (failed > 0) alerts.push({
        id: "bulk-screening-failed",
        title: `${plural(failed, "resume", "resumes")} could not be screened.`,
        description: "These uploads failed in the last 7 days. Open Resume Screening to retry or re-upload them.",
        savedMessage: "The uploaded files are saved.",
        href: "/resume-screening",
        actionLabel: "Review resume screening",
      });
    },
    // 6. Candidate or HR emails that failed, or never left the queue.
    async () => {
      const failed = await countOf(db.select(n).from(applicationStatusHistory).where(and(
        eq(applicationStatusHistory.organizationId, org),
        eq(applicationStatusHistory.notificationStatus, "failed"),
        gte(applicationStatusHistory.changedAt, weekAgo),
      )));
      const stuck = await countOf(db.select(n).from(applicationStatusHistory).where(and(
        eq(applicationStatusHistory.organizationId, org),
        eq(applicationStatusHistory.notificationStatus, "pending"),
        lt(applicationStatusHistory.changedAt, dayAgo),
      )));
      if (failed + stuck > 0) alerts.push({
        id: "emails-failed",
        title: `${plural(failed + stuck, "email has", "emails have")} not been delivered.`,
        description: "A candidate may not have received an invitation or update.",
        savedMessage: "The applicant records are saved.",
        href: "/applicants",
        actionLabel: "Review applicants",
      });
    },
    // 7. An approved role that never went live.
    async () => {
      const waiting = await countOf(db.select(n).from(roles).where(and(
        eq(roles.organizationId, org),
        inArray(roles.status, ["approved", "recruitment_setup"]),
        lt(roles.updatedAt, new Date(now.getTime() - STALLED_ROLE_DAYS * DAY_MS)),
      )));
      if (waiting > 0) alerts.push({
        id: "roles-not-published",
        title: `${plural(waiting, "approved role is", "approved roles are")} not published yet.`,
        description: "Finish recruitment setup and publish the role so candidates can apply.",
        savedMessage: "The role requests are saved.",
        href: "/roles",
        actionLabel: "Review role requests",
      });
    },
  ];

  const results = await Promise.allSettled(checks.map((check) => check()));
  results.forEach((result, index) => {
    if (result.status === "rejected") console.error(`[Dashboard Attention] Check ${index + 1} failed:`, result.reason);
  });
  return alerts;
}
