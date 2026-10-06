import { after } from "next/server";

import { getApplication, listApprovedWithoutInterviewInvitation, listAutoAdvanceCandidates } from "@/lib/internal-recruitment-queries";
import { autoAdvanceComment, evaluateAutoAdvance, isManualOverride, readInterviewAutomation } from "@/lib/interview-automation";
import { isRoleOpenForSelection } from "@/lib/recruitment-role-eligibility";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { approveForInterview, issueInterviewInvitations, type InterviewApprovalMode } from "@/lib/recruitment-target-portal";

/** Recorded on automatic approvals; the history timeline shows it as an automatic update. */
export const INTERVIEW_AUTOMATION_ACTOR = { name: "Interview automation", email: "system@interview-automation.local" };

const LIVE_ROLE_STATUSES = new Set(["approved", "recruitment_setup", "job_posted"]);

type ApplicationRow = NonNullable<Awaited<ReturnType<typeof getApplication>>>;

function roleAcceptsAutomation(row: ApplicationRow) {
  const archive = row.roleArchive && typeof row.roleArchive === "object" ? row.roleArchive as Record<string, unknown> : {};
  if (String(archive.archivedAt ?? "").trim()) return false;
  if (!LIVE_ROLE_STATUSES.has(String(row.roleStatus ?? "").trim().toLowerCase())) return false;
  return isRoleOpenForSelection({ targetHiringDate: row.roleTargetHiringDate });
}

export type AutoAdvanceResult = { advanced: boolean; reason: string };

/**
 * Invite one applicant to interview if their role's Interview automation rule
 * is met. Safe to call any number of times: the stage check runs under a row
 * lock and the action id is fixed per application. Never throws — screening
 * has already committed, and the sweep retries anything that fails here.
 */
export async function maybeAutoAdvance(applicationExternalId: string): Promise<AutoAdvanceResult> {
  const id = String(applicationExternalId || "").trim();
  if (!id || !isPostgresRecruitmentTarget()) return { advanced: false, reason: "not_supported" };
  try {
    const row = await getApplication(id);
    if (!row) return { advanced: false, reason: "unknown_application" };
    const automation = readInterviewAutomation(row.roleSetup);
    if (!automation.enabled) return { advanced: false, reason: "disabled" };
    if (!roleAcceptsAutomation(row)) return { advanced: false, reason: "role_not_open" };
    // A reused resume copies its original screening time onto the new
    // application, so "new" means the later of screening and application time.
    const screenedTimes = row.screeningResult?.screenedAt
      ? [row.screeningResult.screenedAt, row.application.createdAt].map((value) => value ? new Date(value).getTime() : Number.NaN).filter(Number.isFinite)
      : [];
    const decision = evaluateAutoAdvance(automation, {
      currentStage: row.application.currentStage,
      withdrawn: row.application.withdrawn,
      matchScore: row.screeningResult?.matchScore,
      screenedAt: screenedTimes.length > 0 ? new Date(Math.max(...screenedTimes)) : null,
    });
    if (!decision.advance) return { advanced: false, reason: decision.reason };
    const result = await approveForInterview({
      applicationExternalId: id,
      organizationId: row.application.organizationId,
      mode: "auto",
      actor: INTERVIEW_AUTOMATION_ACTOR,
      comments: autoAdvanceComment(decision.score, automation.minScore),
      actionRequestId: `auto-advance:resume:${id}`,
    });
    if (result.updated) return { advanced: true, reason: "advanced" };
    return { advanced: false, reason: "duplicate" in result && result.duplicate ? "already_advanced" : result.error || "not_updated" };
  } catch (error) {
    console.error("[Interview automation] Automatic approval failed; the sweep will retry.", { applicationId: id, error: error instanceof Error ? error.message : String(error) });
    return { advanced: false, reason: "error" };
  }
}

/**
 * Retry net for the post-screening hook: re-evaluate screened applicants on
 * automated roles, and issue missing invitations for applicants whose stage
 * moved to `resume_approved` but whose invitation write failed.
 */
export async function sweepAutoAdvance(input: { organizationId?: string; limit?: number } = {}) {
  if (!isPostgresRecruitmentTarget()) return { evaluated: 0, advanced: 0, invitationsRepaired: 0 };
  const candidates = await listAutoAdvanceCandidates(input);
  let advanced = 0;
  for (const candidate of candidates) {
    if ((await maybeAutoAdvance(candidate.externalId)).advanced) advanced += 1;
  }
  let invitationsRepaired = 0;
  for (const stuck of await listApprovedWithoutInterviewInvitation(input)) {
    try {
      await issueInterviewInvitations(stuck.externalId);
      invitationsRepaired += 1;
    } catch (error) {
      console.error("[Interview automation] Could not repair a missing interview invitation.", { applicationId: stuck.externalId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { evaluated: candidates.length, advanced, invitationsRepaired };
}

const lastOrganizationSweep = new Map<string, number>();
const ORGANIZATION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Opportunistic per-organization sweep (e.g. on dashboard load), at most once per five minutes per instance. Call only inside a request. */
export function scheduleOrganizationAutoAdvanceSweep(organizationId: string) {
  const org = organizationId.trim();
  if (!org || !isPostgresRecruitmentTarget()) return;
  const now = Date.now();
  if (now - (lastOrganizationSweep.get(org) ?? 0) < ORGANIZATION_SWEEP_INTERVAL_MS) return;
  lastOrganizationSweep.set(org, now);
  // Runs after the response is sent, within the route's max duration.
  after(async () => {
    try {
      await sweepAutoAdvance({ organizationId: org, limit: 20 });
    } catch (error) {
      console.error("[Interview automation] Organization sweep failed.", { organizationId: org, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

/**
 * Which history label an HR approval gets: a manual override when the role's
 * automation is on and this applicant is below its minimum score.
 */
export async function hrApprovalMode(applicationExternalId: string, organizationId: string, base: Extract<InterviewApprovalMode, "manual" | "bulk">): Promise<InterviewApprovalMode> {
  if (!isPostgresRecruitmentTarget()) return base;
  const row = await getApplication(applicationExternalId);
  if (!row || row.application.organizationId !== organizationId) return base;
  return isManualOverride(readInterviewAutomation(row.roleSetup), row.screeningResult?.matchScore) ? "manual_override" : base;
}
