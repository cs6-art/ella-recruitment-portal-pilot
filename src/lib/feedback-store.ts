import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { organizations, portalFeedback } from "@/db/schema";
import type { FeedbackSource, FeedbackSubmission } from "@/lib/feedback";

export type FeedbackWho = { organizationId: string; email: string; name: string };

/** The organization and person always come from the signed-in session, never from the request body. */
export async function saveFeedback(who: FeedbackWho, feedback: FeedbackSubmission) {
  await getDb().insert(portalFeedback).values({
    organizationId: who.organizationId,
    userEmail: who.email.trim().toLowerCase(),
    userName: who.name.trim().slice(0, 160),
    source: feedback.source,
    navigationEase: feedback.navigationEase,
    taskCompletion: feedback.taskCompletion,
    aiUsefulness: feedback.aiUsefulness,
    experiencedIssue: feedback.experiencedIssue,
    issueDescription: feedback.issueDescription,
    improvementSuggestion: feedback.improvementSuggestion,
  });
}

export type FeedbackRow = {
  id: string;
  organizationName: string;
  userName: string;
  userEmail: string;
  source: FeedbackSource;
  navigationEase: number;
  taskCompletion: number;
  aiUsefulness: number;
  experiencedIssue: boolean;
  issueDescription: string;
  improvementSuggestion: string;
  createdAt: string;
};

/** Newest first. Platform administrators only: callers must check before using this. */
export async function listFeedback(limit = 300): Promise<FeedbackRow[]> {
  const rows = await getDb()
    .select({
      id: portalFeedback.id,
      organizationName: organizations.name,
      userName: portalFeedback.userName,
      userEmail: portalFeedback.userEmail,
      source: portalFeedback.source,
      navigationEase: portalFeedback.navigationEase,
      taskCompletion: portalFeedback.taskCompletion,
      aiUsefulness: portalFeedback.aiUsefulness,
      experiencedIssue: portalFeedback.experiencedIssue,
      issueDescription: portalFeedback.issueDescription,
      improvementSuggestion: portalFeedback.improvementSuggestion,
      createdAt: portalFeedback.createdAt,
    })
    .from(portalFeedback)
    .innerJoin(organizations, eq(organizations.id, portalFeedback.organizationId))
    .orderBy(desc(portalFeedback.createdAt))
    .limit(Math.max(1, Math.min(limit, 1000)));
  return rows.map((row) => ({ ...row, source: row.source as FeedbackSource, createdAt: row.createdAt.toISOString() }));
}
