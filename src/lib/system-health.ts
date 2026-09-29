import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { applicationStatusHistory, interviewSlots, liveInterviewSessions, voiceCallAttempts } from "@/db/schema-recruitment";

export type HealthIssue = { key: string; label: string; count: number; hint: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const STUCK_STATUSES = ["INTERVIEW_COMPLETED", "TRANSCRIPTION_PROCESSING", "ANALYSIS_PROCESSING"];

async function countOf(query: PromiseLike<{ n: number }[]>) {
  const [row] = await query;
  return row?.n ?? 0;
}

/** Platform-wide problems that need a person: failures in the last 7 days and work that has stalled. */
export async function collectHealthIssues(now = new Date()): Promise<HealthIssue[]> {
  const db = getDb();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const n = sql<number>`count(*)::int`;

  const [failedEmails, staleEmails, failedRecordings, stuckInterviews, failedCalendar, failedCalls] = await Promise.all([
    countOf(db.select({ n }).from(applicationStatusHistory).where(and(eq(applicationStatusHistory.notificationStatus, "failed"), gte(applicationStatusHistory.changedAt, weekAgo)))),
    countOf(db.select({ n }).from(applicationStatusHistory).where(and(eq(applicationStatusHistory.notificationStatus, "pending"), lt(applicationStatusHistory.changedAt, dayAgo)))),
    countOf(db.select({ n }).from(liveInterviewSessions).where(and(eq(liveInterviewSessions.recordingStatus, "failed"), gte(liveInterviewSessions.updatedAt, weekAgo)))),
    countOf(db.select({ n }).from(liveInterviewSessions).where(and(inArray(liveInterviewSessions.status, STUCK_STATUSES), lt(liveInterviewSessions.updatedAt, twoHoursAgo)))),
    countOf(db.select({ n }).from(interviewSlots).where(and(eq(interviewSlots.calendarEventStatus, "failed"), gte(interviewSlots.updatedAt, weekAgo)))),
    countOf(db.select({ n }).from(voiceCallAttempts).where(and(eq(voiceCallAttempts.status, "failed"), gte(voiceCallAttempts.updatedAt, weekAgo)))),
  ]);

  const issues: HealthIssue[] = [
    { key: "emails_failed", label: "Emails that failed to send (7 days)", count: failedEmails, hint: "Check the email workflow and its Gmail connection in n8n." },
    { key: "emails_stale", label: "Emails still queued after 24 hours", count: staleEmails, hint: "The email sender may be switched off or not running." },
    { key: "recordings_failed", label: "Live interview recordings that failed (7 days)", count: failedRecordings, hint: "Check the recording Drive folder, its sharing with the service account, and the deployment settings." },
    { key: "interviews_stuck", label: "Live interviews stuck in processing for over 2 hours", count: stuckInterviews, hint: "Open the applicant and retry the review, or wait for the daily recovery job." },
    { key: "calendar_failed", label: "Calendar events that failed to create (7 days)", count: failedCalendar, hint: "The interviewer's or the shared HR calendar may need to be reconnected." },
    { key: "voice_failed", label: "Voice interview calls that failed (7 days)", count: failedCalls, hint: "Check the voice workflow and provider status." },
  ];
  return issues.filter((issue) => issue.count > 0);
}

export function formatHealthDigest(issues: HealthIssue[]) {
  return issues.map((issue) => `- ${issue.label}: ${issue.count}. ${issue.hint}`).join("\n");
}
