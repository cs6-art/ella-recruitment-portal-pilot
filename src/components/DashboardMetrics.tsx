"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import InfoTip from "@/components/InfoTip";
import { formatPortalDateTime } from "@/lib/portal-time";

type RecentRequest = { roleId: string; jobTitle: string; department: string; status: string; createdAt: string; targetHiringDate: string };
type ApplicantStageCount = { key: string; label: string; tone: string; value: number };
type ApplicantMetrics = { total: number; today: number; screened: number; interviewed: number; resumeApproved: number; voiceBookingPending: number; voiceScheduled: number; voiceReviewPending: number; approvedForFinal: number; finalScheduled: number; finalDecisionPending: number; rejected: number; passedFinalInterview: number; stageCounts: ApplicantStageCount[] };
type Metrics = { pendingHrDiscussion: number; approved: number; rejected: number; openPositions: number; openPositionsAssumption?: string; recentRequests?: RecentRequest[]; applicantMetrics?: ApplicantMetrics };

function formatDate(value: string, includeTime = true) {
  return formatPortalDateTime(value, includeTime);
}

function statusClass(status: string) { return `status-badge status-${status.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`; }
function MetricSkeleton() { return <article className="dashboard-stat-card dashboard-stat-skeleton" aria-hidden="true"><span /><strong /><small /></article>; }
function percentage(value: number, total: number) { return total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0; }

export default function DashboardMetrics({ scope = "organization" }: { scope?: "personal" | "organization" }) {
  const personalScope = scope === "personal";
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard/metrics", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to load dashboard metrics.");
        if (active) setMetrics(data.metrics);
      })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard metrics."); });
    return () => { active = false; };
  }, []);

  const recentCount = metrics?.recentRequests?.length ?? 0;
  const applicantMetrics = metrics?.applicantMetrics;
  const applicantBars = applicantMetrics?.stageCounts ?? [];

  return <>
    <section className="dashboard-role-actions dashboard-role-actions-overview" aria-labelledby="dashboard-role-actions-title">
      <div className="dashboard-candidate-heading"><div><span className="dashboard-metrics-overview-label dashboard-stat-title-with-info">Role Request Actions<InfoTip label="What are Role Request Actions?">These are the role requests grouped by their current workflow state, so each count is shown only once.</InfoTip></span><h2 id="dashboard-role-actions-title">{personalScope ? "My Role Request Overview" : "Role Request Overview"}</h2><p>Pending HR review, approved, rejected, and active recruitment positions.</p></div><Link className="dashboard-panel-link" href="/roles">View Role Requests <span aria-hidden="true">&rarr;</span></Link></div>
      <div className="dashboard-role-action-grid">{!metrics && !error ? <><MetricSkeleton /><MetricSkeleton /><MetricSkeleton /><MetricSkeleton /></> : metrics ? <>
        <Link className="dashboard-role-action-card dashboard-role-action-review" href="/roles?status=Pending%20HR%20Discussion"><span>Pending HR Review</span><strong>{metrics.pendingHrDiscussion}</strong><small>Review the requisition, then approve, reject, return, or hold.</small></Link>
        <Link className="dashboard-role-action-card dashboard-role-action-approved" href="/roles?status=Approved"><span>Approved Roles</span><strong>{metrics.approved}</strong><small>Ready for recruitment setup and posting.</small></Link>
        <Link className="dashboard-role-action-card dashboard-role-action-rejected" href="/roles?status=Rejected"><span>Rejected Role Requests</span><strong>{metrics.rejected}</strong><small>Explicit role-request rejection recorded.</small></Link>
        <Link className="dashboard-role-action-card dashboard-role-action-open" href="/roles"><span>Open Positions</span><strong>{metrics.openPositions}</strong><small>Approved or active roles currently in recruitment.</small></Link>
      </> : null}</div>
    </section>

    {!personalScope && applicantMetrics && <section className="dashboard-candidate-overview" aria-labelledby="dashboard-candidate-overview-title">
      <div className="dashboard-candidate-heading"><div><span className="dashboard-metrics-overview-label dashboard-stat-title-with-info">Applicant Workflow<InfoTip label="What is the Applicant Workflow?">These sections show where applicants are in the hiring process and which actions are waiting for HR.</InfoTip></span><h2 id="dashboard-candidate-overview-title">Candidate Pipeline</h2><p>Focus on the current workflow stage and the next HR decision.</p></div><Link className="dashboard-panel-link" href="/applicants">View Applicants <span aria-hidden="true">&rarr;</span></Link></div>
      <div className="dashboard-candidate-body">
        <div className="dashboard-candidate-progress">
          <div className="dashboard-candidate-section-heading"><div><h3 className="dashboard-stat-title-with-info">Pipeline Progress<InfoTip label="How is Pipeline Progress counted?">Each applicant is assigned to one current workflow stage, so these counts reconcile exactly to the total.</InfoTip></h3><p>Each applicant appears once in their latest workflow stage.</p></div><strong>{applicantMetrics.total} Total</strong></div>
          <div className="dashboard-candidate-bars">{applicantBars.map((bar) => <div className="dashboard-candidate-bar-row" key={bar.label}><div><span>{bar.label}</span><strong>{bar.value} <small>{percentage(bar.value, applicantMetrics.total)}%</small></strong></div><div className="dashboard-candidate-bar-track"><span className={`dashboard-candidate-bar-fill dashboard-candidate-bar-${bar.tone}`} style={{ width: `${percentage(bar.value, applicantMetrics.total)}%` }} /></div></div>)}</div>
        </div>
        <div className="dashboard-candidate-outcomes">
          <div className="dashboard-candidate-section-heading"><div><h3 className="dashboard-stat-title-with-info">Decision Snapshot<InfoTip label="What is the Decision Snapshot?">This is the same reconciled current-stage distribution, shown as decision-ready counts.</InfoTip></h3><p>Every applicant is represented exactly once.</p></div><strong>{applicantMetrics.total} Total</strong></div>
          {applicantBars.map((stage) => <div className="dashboard-candidate-outcome-row" key={stage.key}><span className={`dashboard-candidate-outcome-dot dashboard-candidate-outcome-dot-${stage.tone}`} aria-hidden="true" /><div><strong>{stage.label}</strong><small>Current workflow stage</small></div><b>{stage.value}</b></div>)}
        </div>
      </div>
    </section>}

    <section className="dashboard-panel dashboard-recent" aria-live="polite"><div className="dashboard-panel-header dashboard-recent-header"><div><h2>{personalScope ? "My Recent Role Requests" : "Recent Role Requests"}</h2><p>{personalScope ? "Latest requests submitted by you." : "Latest requests visible to you."}</p></div><Link className="dashboard-panel-link" href="/roles" aria-label={`${personalScope ? "View my" : "View all"} ${recentCount} role requests`}>{personalScope ? "View My" : "View All"} {recentCount} Requests <span aria-hidden="true">&rarr;</span></Link></div><div className="dashboard-recent-column-header" aria-hidden="true"><span>Role</span><span>Department</span><span>Status</span><span>Created</span><span>Target Date</span><span>Action</span></div>{!metrics && !error && <div className="dashboard-recent-state dashboard-recent-skeleton">Loading recent role requests...</div>}{error && <div className="dashboard-recent-state dashboard-recent-error" role="alert">Unable to load recent role requests.</div>}{metrics && !error && recentCount === 0 && <div className="dashboard-recent-state">{personalScope ? "You have not submitted any role requests yet." : "No role requests available."}</div>}{metrics && !error && recentCount > 0 && <div className="dashboard-recent-list">{metrics.recentRequests?.map((role) => <div className="dashboard-recent-row" key={role.roleId}><div className="dashboard-recent-title"><strong>{role.jobTitle || "Untitled role"}</strong><span>{role.roleId}</span></div><div className="dashboard-recent-field"><span className="dashboard-recent-label">Department</span><span>{role.department || "Not provided"}</span></div><div className="dashboard-recent-field"><span className="dashboard-recent-label">Status</span><span className={statusClass(role.status)}>{role.status || "Submitted"}</span></div><div className="dashboard-recent-field"><span className="dashboard-recent-label">Created</span><span>{formatDate(role.createdAt)}</span></div><div className="dashboard-recent-field"><span className="dashboard-recent-label">Target Date</span><span>{formatDate(role.targetHiringDate, false)}</span></div><Link className="dashboard-recent-action" href={`/roles/${encodeURIComponent(role.roleId)}`} aria-label={`View details for ${role.jobTitle || role.roleId}`}>View Details</Link></div>)}</div>}</section>
  </>;
}
