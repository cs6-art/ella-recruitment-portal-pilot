"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Readiness = {
  ownerStatus: "Registered" | "Awaiting registration";
  creditsAdded: boolean;
  recordingStorageApplicable: boolean;
  recordingStorageReady: boolean;
  googleCalendarApplicable: boolean;
  googleCalendarReady: boolean;
  firstRolePublished: boolean;
  hasRoles: boolean;
  overallStatus: "Setup required" | "Partially configured" | "Ready to recruit";
  onboardingEnabled: boolean;
  brandingConfigured: boolean;
  hasCandidates: boolean;
  hasTeammates: boolean;
  automatedEmailsCustomized: boolean;
};

type Step = {
  key: string;
  title: string;
  detail: string;
  done: boolean;
  required: boolean;
  marker: "conditional" | "optional" | "after setup" | "";
  status: string;
  href: string;
  action: string;
};

const storageKey = (organizationId: string) => `getting-started-hidden:${organizationId}`;

function LoadingChecklist() {
  return <section className="getting-started getting-started-loading" aria-busy="true" aria-label="Checking workspace setup">
    <div className="getting-started-header"><div><span className="dashboard-eyebrow">GETTING STARTED</span><div className="getting-started-loading-title" /></div><div className="getting-started-loading-progress" /></div>
    <div className="getting-started-loading-rows" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <div key={index} />)}</div>
    <p className="sr-only" role="status">Checking your organization setup.</p>
  </section>;
}

export default function GettingStarted({ organizationId }: { organizationId: string }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [hidden, setHidden] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch("/api/organization/readiness", { credentials: "same-origin", cache: "no-store" });
      const data = await response.json();
      if (!response.ok || data.success !== true || !data.readiness) throw new Error(data.error || "Unable to check workspace setup.");
      setReadiness(data.readiness as Readiness);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "We couldn’t check workspace setup. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(storageKey(organizationId)) === "1");
    } catch {
      setHidden(false);
    }
  }, [organizationId]);

  useEffect(() => {
    if (hidden === true) return;
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh, hidden]);

  const steps = useMemo<Step[]>(() => {
    if (!readiness) return [];
    const roleAction = readiness.hasRoles ? "/roles" : "/roles/new";
    return [
      {
        key: "branding",
        title: "Review organization name and branding",
        detail: readiness.brandingConfigured
          ? "The organization name and portal subtitle are saved. Change them any time in Settings."
          : "Smile’s default branding will keep the workspace working until you choose a name and subtitle.",
        done: readiness.brandingConfigured,
        required: false,
        marker: "optional",
        status: readiness.brandingConfigured ? "Ready" : "Using defaults",
        href: "/settings",
        action: "Review branding",
      },
      {
        key: "credits",
        title: "Add Smile Credits",
        detail: readiness.creditsAdded
          ? "Your organization has credits available for resume screening and interviews."
          : "Credits cover resume screening and AI interviews. Add credits before using those services.",
        done: readiness.creditsAdded,
        required: true,
        marker: "",
        status: readiness.creditsAdded ? "Added" : "Not added",
        href: "/credits",
        action: "Add credits",
      },
      {
        key: "recording-storage",
        title: "Configure Google Drive for Live Avatar recordings",
        detail: !readiness.recordingStorageApplicable
          ? "This is only needed if your organization uses Live Avatar interviews."
          : readiness.recordingStorageReady
            ? "Live Avatar recordings have an organization-owned Google Drive destination."
            : "Live Avatar is in use, so connect this organization’s Google account and choose a Drive folder before the next interview.",
        done: !readiness.recordingStorageApplicable || readiness.recordingStorageReady,
        required: readiness.recordingStorageApplicable,
        marker: "conditional",
        status: !readiness.recordingStorageApplicable ? "Not needed yet" : readiness.recordingStorageReady ? "Connected" : "Required",
        href: "/settings#recording-drive-settings-title",
        action: "Set up Drive",
      },
      {
        key: "calendar",
        title: "Connect Google Calendar",
        detail: !readiness.googleCalendarApplicable
          ? "This is only needed when a role is set up for Face-to-Face Interviews."
          : readiness.googleCalendarReady
            ? "Your organization’s interview calendar is connected."
            : "A role requires Face-to-Face Interviews. Connect the calendar so candidates can book an available time.",
        done: !readiness.googleCalendarApplicable || readiness.googleCalendarReady,
        required: readiness.googleCalendarApplicable,
        marker: "conditional",
        status: !readiness.googleCalendarApplicable ? "Not needed yet" : readiness.googleCalendarReady ? "Connected" : "Required",
        href: "/settings#calendar-settings-title",
        action: "Connect calendar",
      },
      {
        key: "role",
        title: "Create and publish your first role",
        detail: readiness.firstRolePublished
          ? "Your first role is published and ready to receive candidates."
          : readiness.hasRoles
            ? "You have a role in progress. Finish any remaining details, then publish it to accept candidates."
            : "Add the job details and screening questions. Smile can suggest questions from the job description.",
        done: readiness.firstRolePublished,
        required: true,
        marker: "",
        status: readiness.firstRolePublished ? "Published" : "Not published",
        href: roleAction,
        action: readiness.hasRoles ? "Open roles" : "Create a role",
      },
      {
        key: "candidates",
        title: "Add candidates",
        detail: readiness.hasCandidates
          ? "Candidates have started applying to or been added to your roles."
          : "Share your role’s application link or upload resumes for screening. This is the next step once setup is ready.",
        done: readiness.hasCandidates,
        required: false,
        marker: "after setup",
        status: readiness.hasCandidates ? "Added" : "After setup",
        href: "/resume-screening",
        action: "Add candidates",
      },
      {
        key: "teammates",
        title: "Invite teammates",
        detail: readiness.hasTeammates
          ? "More than one active team member is set up."
          : "Invite colleagues by their individual email addresses when you are ready to share access.",
        done: readiness.hasTeammates,
        required: false,
        marker: "optional",
        status: readiness.hasTeammates ? "Team added" : "Optional",
        href: "/user-accounts",
        action: "Manage team",
      },
      {
        key: "emails",
        title: "Customize automated emails",
        detail: readiness.automatedEmailsCustomized
          ? "Your organization has saved its own email wording."
          : "Smile’s standard email wording is ready to use. Customize it only if you want different wording.",
        done: readiness.automatedEmailsCustomized,
        required: false,
        marker: "optional",
        status: readiness.automatedEmailsCustomized ? "Customized" : "Optional",
        href: "/settings#automated-emails",
        action: "Review emails",
      },
    ];
  }, [readiness]);

  if (hidden === null || (loading && hidden === false)) return <LoadingChecklist />;
  if (readiness && !readiness.onboardingEnabled) return null;

  const requiredSteps = steps.filter((step) => step.required);
  const completedRequired = requiredSteps.filter((step) => step.done).length;
  const ready = requiredSteps.length > 0 && completedRequired === requiredSteps.length;

  function hideChecklist() {
    try {
      window.localStorage.setItem(storageKey(organizationId), "1");
    } catch {
      // The checklist remains available if local browser storage is disabled.
    }
    setHidden(true);
  }

  function reopenChecklist() {
    try {
      window.localStorage.removeItem(storageKey(organizationId));
    } catch {
      // Keep the page usable even if local browser storage is disabled.
    }
    setHidden(false);
  }

  if (hidden) return <section className="getting-started-reopen" aria-label="Workspace setup">
    {ready && <strong>Ready to recruit</strong>}
    <button type="button" className="btn btn-secondary" onClick={reopenChecklist}>Open setup checklist</button>
  </section>;

  if (loadError || !readiness) return <section className="getting-started getting-started-error" aria-labelledby="getting-started-title">
    <div className="getting-started-header"><div><span className="dashboard-eyebrow">GETTING STARTED</span><h2 id="getting-started-title">Set up your organization</h2><p>We couldn’t check the latest setup information. Your saved progress is safe.</p></div></div>
    <div className="getting-started-error-actions"><p role="alert">{loadError || "Workspace setup is temporarily unavailable."}</p><button type="button" className="btn btn-secondary" onClick={() => void refresh(true)} disabled={refreshing}>{refreshing ? "Checking…" : "Try again"}</button></div>
    <button type="button" className="getting-started-hide" onClick={hideChecklist}>Hide this checklist</button>
  </section>;

  const nextStep = steps.find((step) => step.required && !step.done);

  return <section className={`getting-started${ready ? " is-ready" : ""}`} aria-labelledby="getting-started-title" aria-busy={refreshing}>
    <div className="getting-started-header">
      <div>
        <span className="dashboard-eyebrow">GETTING STARTED</span>
        <h2 id="getting-started-title">{ready ? "Ready to recruit" : "Set up your organization"}</h2>
        <p>{ready ? "All required setup is complete. You can now welcome candidates and continue refining your workspace." : "Follow these steps in order. Setup status is checked from your organization’s saved information."}</p>
      </div>
      <div className="getting-started-progress" aria-label={`${completedRequired} of ${requiredSteps.length} required setup steps complete`}>
        <strong>{completedRequired} of {requiredSteps.length} required</strong>
        <span className="getting-started-bar"><span style={{ width: `${(completedRequired / requiredSteps.length) * 100}%` }} /></span>
        <small>{refreshing ? "Updating…" : "Updates automatically"}</small>
      </div>
    </div>
    <ol className="getting-started-steps">
      {steps.map((step, index) => (
        <li key={step.key} className={`getting-started-step${step.done ? " is-done" : ""}${step.key === nextStep?.key ? " is-next" : ""}${step.marker ? " is-marked" : ""}`}>
          <span className="getting-started-marker" aria-hidden="true">{step.done ? "✓" : index + 1}</span>
          <div className="getting-started-copy">
            <strong>{step.title}{step.marker && <span className="getting-started-optional">{step.marker === "after setup" ? "After setup" : step.marker === "conditional" ? "Conditional" : "Optional"}</span>}</strong>
            <p>{step.detail}</p>
            <small className={`getting-started-status ${step.done ? "is-done" : step.required ? "is-pending" : "is-optional"}`}>{step.status}</small>
          </div>
          {(!step.done || step.marker === "optional" || step.key === "branding") && <Link className={`btn ${step.key === nextStep?.key ? "btn-primary" : "btn-secondary"}`} href={step.href}>{step.action}</Link>}
        </li>
      ))}
    </ol>
    <div className="getting-started-footer"><button type="button" className="getting-started-hide" onClick={hideChecklist}>Hide this checklist</button><button type="button" className="getting-started-refresh" onClick={() => void refresh(true)} disabled={refreshing}>{refreshing ? "Checking…" : "Refresh setup status"}</button></div>
  </section>;
}
