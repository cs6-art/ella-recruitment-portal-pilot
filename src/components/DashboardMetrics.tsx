"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import GettingStarted from "@/components/GettingStarted";
import UiIcon from "@/components/UiIcon";
import { formatPortalDateTime } from "@/lib/portal-time";

type RecentRequest = { roleId: string; jobTitle: string; department: string; status: string; createdAt: string; targetHiringDate: string; requesterName: string };
type ApplicantStageCount = { key: string; label: string; tone: string; value: number };
type ApplicantMetrics = {
  total: number;
  screened: number;
  resumeApproved: number;
  voiceBookingPending: number;
  voiceScheduled: number;
  voiceReviewPending: number;
  approvedForFinal: number;
  finalScheduled: number;
  finalDecisionPending: number;
  rejected: number;
  passedFinalInterview: number;
  stageCounts: ApplicantStageCount[];
};
type DashboardActivity = { id: string; actor: string; action: string; subject: string; occurredAt: string; href: string };
type DashboardInterview = {
  applicationId: string;
  candidateName: string;
  roleTitle: string;
  interviewType: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  status: string;
  interviewerName: string;
  href: string;
};
type DashboardAlert = { id: string; title: string; description: string; savedMessage: string; href: string; actionLabel: string };
type SectionErrors = { overview?: boolean; upcomingInterviews?: boolean; alerts?: boolean; recentActivity?: boolean; activityPartial?: boolean };
type Metrics = {
  total?: number;
  jobPosted?: number;
  pendingHrDiscussion?: number;
  approved?: number;
  rejected?: number;
  openPositions?: number;
  recentRequests?: RecentRequest[];
  applicantMetrics?: ApplicantMetrics;
  upcomingInterviews?: DashboardInterview[];
  alerts?: DashboardAlert[];
  recentActivity?: DashboardActivity[];
  sectionErrors?: SectionErrors;
  lastUpdatedAt?: string;
};
type TaskItem = { id: string; message: string; detail: string; action: string; href: string };

function countFor(metrics: ApplicantMetrics, key: string) {
  return metrics.stageCounts.find((stage) => stage.key === key)?.value ?? 0;
}

function dateTime(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Time not provided";
  return formatPortalDateTime(value, true);
}

function interviewDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "Date not provided";
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function DashboardSkeleton() {
  return <div className="dashboard-loading-grid" aria-label="Loading your dashboard">
    <section className="dashboard-skeleton dashboard-skeleton-attention" aria-hidden="true"><span /><i /><i /><i /></section>
    <section className="dashboard-skeleton" aria-hidden="true"><span /><i /><i /><i /><i /></section>
    <div className="dashboard-skeleton-columns"><section className="dashboard-skeleton" aria-hidden="true"><span /><i /><i /><i /></section><section className="dashboard-skeleton" aria-hidden="true"><span /><i /><i /></section></div>
    <p className="sr-only" role="status">Loading dashboard information.</p>
  </div>;
}

function StageLink({ label, value, href }: { label: string; value: number; href: string }) {
  return <Link className="dashboard-pipeline-row" href={href}>
    <span>{label}</span>
    <strong>{value}</strong>
    <span className="dashboard-pipeline-arrow" aria-hidden="true">→</span>
  </Link>;
}

export default function DashboardMetrics({
  scope = "organization",
  organizationId,
  userName,
  canCreateRole = false,
  canReviewRole = false,
  canApproveRole = false,
}: {
  scope?: "personal" | "organization";
  organizationId?: string;
  userName: string;
  canCreateRole?: boolean;
  canReviewRole?: boolean;
  canApproveRole?: boolean;
}) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [slowMessage, setSlowMessage] = useState(false);
  const requestInFlight = useRef(false);
  const personalScope = scope === "personal";

  const refresh = useCallback(async (manual = false) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const controller = new AbortController();
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    let requestTimeout: ReturnType<typeof setTimeout> | undefined;
    if (manual) {
      setRefreshing(true);
      setSlowMessage(false);
      slowTimer = setTimeout(() => setSlowMessage(true), 4000);
    }
    try {
      requestTimeout = setTimeout(() => controller.abort(), 20000);
      const response = await fetch("/api/dashboard/metrics", {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error("Unable to load dashboard information.");
      setMetrics(data.metrics as Metrics);
      setRefreshError("");
    } catch {
      setRefreshError("We couldn’t refresh the latest information.");
    } finally {
      if (requestTimeout) clearTimeout(requestTimeout);
      if (slowTimer) clearTimeout(slowTimer);
      requestInFlight.current = false;
      setInitialLoading(false);
      setRefreshing(false);
      setSlowMessage(false);
    }
  }, []);

  // Poll only while the tab is visible; the shared in-flight guard prevents
  // overlapping requests when the timer and tab-focus event happen together.
  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  if (initialLoading && !metrics) {
    return <main className="container page dashboard-page" aria-busy="true">
      <header className="dashboard-welcome"><div><h1>Hello, {userName}</h1><p>Here’s what needs your attention today.</p><span className="dashboard-update-note">Updates every 30 seconds</span></div></header>
      <DashboardSkeleton />
    </main>;
  }

  if (!metrics) {
    return <main className="container page dashboard-page">
      <header className="dashboard-welcome"><div><h1>Hello, {userName}</h1><p>Here’s what needs your attention today.</p></div></header>
      <div className="dashboard-load-error" role="alert"><p>{refreshError || "We couldn’t load your dashboard."}</p><button type="button" className="btn btn-secondary" disabled={refreshing} onClick={() => void refresh(true)}>{refreshing ? "Refreshing…" : "Try again"}</button></div>
      {slowMessage && <p className="dashboard-slow-message" role="status">This is taking longer than expected. You can continue viewing the dashboard.</p>}
    </main>;
  }

  const sectionErrors = metrics.sectionErrors || {};
  const applicantMetrics = metrics.applicantMetrics;
  const tasks: TaskItem[] = [];
  const task = (id: string, value: number, singular: string, plural: string, detail: string, action: string, href: string) => {
    if (value > 0) tasks.push({ id, message: `${value} ${value === 1 ? singular : plural}`, detail, action, href });
  };

  if (canReviewRole) task("role-review", metrics.pendingHrDiscussion || 0, "role request needs review", "role requests need review", "A hiring request is waiting for an HR decision.", "Review requests", "/roles?status=Pending%20HR%20Discussion");
  if (canReviewRole && applicantMetrics) task("resume-review", countFor(applicantMetrics, "resume_review"), "candidate needs resume review", "candidates need resume review", "Review the application and decide whether it should move forward.", "Review candidates", "/applicants?stage=Resume%20Review");
  if (canReviewRole && applicantMetrics) task("avatar-review", applicantMetrics.voiceReviewPending, "Avatar Interview Review is waiting", "Avatar Interview Reviews are waiting", "A completed interview is ready for HR review.", "Review avatar interviews", "/applicants?stage=Avatar%20Interview%20Review");
  if (canReviewRole && applicantMetrics) task("avatar-scheduling", applicantMetrics.voiceBookingPending, "Avatar interview needs scheduling", "Avatar interviews need scheduling", "These candidates are ready for the next interview step.", "Manage interview schedule", "/applicants?stage=Avatar%20Interview%20Booking%20Pending");
  if (canReviewRole && applicantMetrics) task("face-to-face-scheduling", applicantMetrics.approvedForFinal, "face-to-face interview needs scheduling", "face-to-face interviews need scheduling", "These candidates are ready for a face-to-face interview.", "Review candidates", "/applicants?stage=Approved%20for%20Face-to-Face%20Interview");
  if ((canReviewRole || canApproveRole) && applicantMetrics) task("final-decision", applicantMetrics.finalDecisionPending, "hiring decision needs review", "hiring decisions need review", "A face-to-face interview is complete and needs a decision.", "Review decisions", "/applicants?stage=Face-to-Face%20Decision%20Pending");

  const pipeline = applicantMetrics ? [
    { label: "Applications received", value: applicantMetrics.total, filter: "" },
    { label: "Resume review", value: countFor(applicantMetrics, "resume_review"), filter: "Resume Review" },
    { label: "Avatar interview", value: applicantMetrics.resumeApproved + applicantMetrics.voiceBookingPending + applicantMetrics.voiceScheduled, filter: "Avatar Interview" },
    { label: "Avatar Interview Review", value: applicantMetrics.voiceReviewPending, filter: "Avatar Interview Review" },
    { label: "Face-to-face interview", value: applicantMetrics.approvedForFinal + applicantMetrics.finalScheduled, filter: "Face-to-Face Interview" },
    { label: "Final decision", value: applicantMetrics.finalDecisionPending, filter: "Face-to-Face Decision Pending" },
    { label: "Completed", value: applicantMetrics.passedFinalInterview + applicantMetrics.rejected, filter: "Completed" },
  ] : [];

  const upcoming = metrics.upcomingInterviews || [];
  const alerts = metrics.alerts || [];
  const activity = metrics.recentActivity || [];
  const lastUpdated = metrics.lastUpdatedAt ? dateTime(metrics.lastUpdatedAt) : "just now";
  return <main className="container page dashboard-page">
    <header className="dashboard-welcome">
      <div className="dashboard-welcome-copy">
        <h1>Hello, {userName}</h1>
        <p>Here’s what needs your attention today.</p>
        <div className="dashboard-update-note"><span>Updates every 30 seconds</span><span aria-hidden="true">·</span><span>Last updated at {lastUpdated}</span></div>
      </div>
      <div className="dashboard-header-actions">
        {canCreateRole && <Link className="btn btn-primary" href="/roles/new"><UiIcon name="plus" size={17} />Create hiring request</Link>}
        <button type="button" className="btn btn-secondary dashboard-refresh-button" onClick={() => void refresh(true)} disabled={refreshing}>
          <UiIcon name="refresh" size={17} className={refreshing ? "dashboard-refresh-icon is-spinning" : "dashboard-refresh-icon"} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </header>

    {refreshError && <div className="dashboard-refresh-error" role="alert"><span>{refreshError}</span><button type="button" className="dashboard-inline-action" onClick={() => void refresh(true)} disabled={refreshing}>Try again</button><button type="button" className="dashboard-dismiss" onClick={() => setRefreshError("")} aria-label="Dismiss refresh message">×</button></div>}
    {slowMessage && <p className="dashboard-slow-message" role="status">This is taking longer than expected. You can continue viewing the dashboard.</p>}
    <p className="sr-only" role="status" aria-live="polite">{refreshing ? "Refreshing dashboard information." : ""}</p>

    <section className="dashboard-section dashboard-attention" aria-labelledby="dashboard-attention-title" aria-busy={refreshing}>
      <div className="dashboard-section-heading">
        <div><h2 id="dashboard-attention-title">What needs your attention</h2><p>Start with the items waiting for action.</p></div>
        {tasks.length > 0 && <span className="dashboard-attention-count">{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span>}
      </div>
      {sectionErrors.overview && <div className="dashboard-section-message" role="status">Some items couldn’t be loaded. Try refreshing to see the latest tasks.</div>}
      {tasks.length === 0 && !sectionErrors.overview && <div className="dashboard-all-clear"><UiIcon name="check-circle" size={22} /><p>You’re all caught up. There are no items requiring your attention.</p></div>}
      {tasks.length > 0 && <>
        <ul className="dashboard-task-list">{tasks.slice(0, 4).map((item) => <li key={item.id}><Link className="dashboard-task-row" href={item.href}><span className="dashboard-task-icon" aria-hidden="true"><UiIcon name="document" size={19} /></span><span className="dashboard-task-copy"><strong>{item.message}</strong><small>{item.detail}</small></span><span className="dashboard-task-action">{item.action}<span aria-hidden="true">→</span></span></Link></li>)}</ul>
        {tasks.length > 4 && <details className="dashboard-more-tasks"><summary>View {tasks.length - 4} more {tasks.length - 4 === 1 ? "task" : "tasks"}</summary><ul className="dashboard-task-list">{tasks.slice(4).map((item) => <li key={item.id}><Link className="dashboard-task-row" href={item.href}><span className="dashboard-task-icon" aria-hidden="true"><UiIcon name="document" size={19} /></span><span className="dashboard-task-copy"><strong>{item.message}</strong><small>{item.detail}</small></span><span className="dashboard-task-action">{item.action}<span aria-hidden="true">→</span></span></Link></li>)}</ul></details>}
      </>}
    </section>

    <section className="dashboard-section dashboard-overview" aria-labelledby="dashboard-overview-title" aria-busy={refreshing}>
      <div className="dashboard-section-heading"><div><h2 id="dashboard-overview-title">Recruitment overview</h2><p>{applicantMetrics ? "See how applications are moving through the hiring process." : "See the current status of your hiring requests."}</p></div>{applicantMetrics && <Link className="dashboard-text-link" href="/applicants">View candidates <span aria-hidden="true">→</span></Link>}</div>
      {sectionErrors.overview && <div className="dashboard-section-message" role="status">We couldn’t load part of the recruitment overview. Try refreshing.</div>}
      {applicantMetrics ? <>
        <div className="dashboard-pipeline-list">{pipeline.map((stage) => <StageLink key={stage.label} label={stage.label} value={stage.value} href={stage.filter ? `/applicants?stage=${encodeURIComponent(stage.filter)}` : "/applicants"} />)}</div>
        <p className="dashboard-pipeline-note">The total shows all applications. The other counts show each candidate’s current stage. “Completed” includes candidates who passed or were not selected.</p>
        {canReviewRole && organizationId && !personalScope && <GettingStarted organizationId={organizationId} metrics={metrics} />}
      </> : metrics.total !== undefined ? <div className="dashboard-role-overview">
        <StageLink label="Role requests waiting for HR review" value={metrics.pendingHrDiscussion || 0} href="/roles?status=Pending%20HR%20Discussion" />
        <StageLink label="Approved hiring requests" value={metrics.approved || 0} href="/roles?status=Approved" />
        <StageLink label="Open positions" value={metrics.openPositions || 0} href="/roles" />
      </div> : <div className="dashboard-section-message">Recruitment overview isn’t available right now.</div>}
    </section>

    {canReviewRole && <section className="dashboard-section dashboard-upcoming" aria-labelledby="dashboard-upcoming-title" aria-busy={refreshing}>
      <div className="dashboard-section-heading"><div><h2 id="dashboard-upcoming-title">Upcoming interviews</h2><p>The next scheduled interviews you can manage.</p></div><Link className="dashboard-text-link" href="/bookings">View all interviews <span aria-hidden="true">→</span></Link></div>
      {sectionErrors.upcomingInterviews ? <div className="dashboard-section-message" role="status">We couldn’t load upcoming interviews. Try refreshing.</div> : upcoming.length === 0 ? <div className="dashboard-empty-state"><UiIcon name="calendar" size={20} /><p>There are no upcoming interviews.</p><Link className="dashboard-text-link" href="/bookings">Manage interview schedules <span aria-hidden="true">→</span></Link></div> : <ul className="dashboard-interview-list">{upcoming.map((interview) => <li key={`${interview.applicationId}:${interview.date}:${interview.startTime}`}><article className="dashboard-interview-row"><div className="dashboard-interview-date"><strong>{interviewDate(interview.date)}</strong><span>{interview.startTime}–{interview.endTime} · {interview.timezone}</span></div><div className="dashboard-interview-candidate"><strong>{interview.candidateName}</strong><span>{interview.roleTitle}</span></div><div className="dashboard-interview-meta"><span className="dashboard-interview-type">{interview.interviewType}</span><span>{interview.interviewerName ? `Interviewer: ${interview.interviewerName}` : "Interviewer not assigned"}</span></div><span className="dashboard-status-label"><UiIcon name="check-circle" size={15} />Scheduled</span><Link className="dashboard-interview-link" href={interview.href}>View details</Link></article></li>)}</ul>}
    </section>}

    {canReviewRole && <section className="dashboard-section dashboard-alerts" aria-labelledby="dashboard-alerts-title" aria-busy={refreshing}>
      <div className="dashboard-section-heading"><div><h2 id="dashboard-alerts-title">Actionable alerts</h2><p>Issues that need someone to follow up.</p></div>{alerts.length > 0 && <span className="dashboard-alert-count">{alerts.length} to resolve</span>}</div>
      {sectionErrors.alerts && <div className="dashboard-section-message" role="status">We couldn’t check all interview and recording issues. Try refreshing.</div>}
      {alerts.length === 0 && !sectionErrors.alerts ? <div className="dashboard-empty-state"><UiIcon name="check-circle" size={20} /><p>No issues need your attention right now.</p></div> : alerts.length > 0 ? <ul className="dashboard-alert-list">{alerts.map((alert) => <li key={alert.id}><article className="dashboard-alert-row"><span className="dashboard-alert-icon" aria-hidden="true"><UiIcon name="alert" size={19} /></span><div className="dashboard-alert-copy"><strong>{alert.title}</strong><p>{alert.description}</p><small>{alert.savedMessage}</small></div><Link className="dashboard-alert-action" href={alert.href}>{alert.actionLabel}<span aria-hidden="true">→</span></Link></article></li>)}</ul> : null}
    </section>}

    <section className="dashboard-section dashboard-activity" aria-labelledby="dashboard-activity-title" aria-busy={refreshing}>
      <div className="dashboard-section-heading"><div><h2 id="dashboard-activity-title">Recent activity</h2><p>New applications and hiring requests.</p></div></div>
      {sectionErrors.recentActivity ? <div className="dashboard-section-message" role="status">We couldn’t load recent activity. Try refreshing.</div> : <>
        {sectionErrors.activityPartial && <p className="dashboard-partial-note" role="status">Some recent updates couldn’t be loaded.</p>}
        {activity.length === 0 ? <div className="dashboard-empty-state"><UiIcon name="info" size={20} /><p>No recent activity is available yet.</p></div> : <ul className="dashboard-activity-list">{activity.map((item) => <li key={item.id}><Link className="dashboard-activity-row" href={item.href}><span className="dashboard-activity-marker" aria-hidden="true"><UiIcon name={item.id.startsWith("application:") ? "applicants" : "roles"} size={17} /></span><span className="dashboard-activity-copy"><span><strong>{item.actor}</strong> {item.action} <strong>{item.subject}</strong></span><time dateTime={item.occurredAt}>{dateTime(item.occurredAt)}</time></span><span className="dashboard-pipeline-arrow" aria-hidden="true">→</span></Link></li>)}</ul>}
      </>}
    </section>
  </main>;
}
