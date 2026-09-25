"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type StartMetrics = { total?: number; jobPosted?: number; applicantMetrics?: { total: number } };

type Step = {
  key: string;
  title: string;
  detail: string;
  done: boolean;
  optional?: boolean;
  href: string;
  action: string;
};

const storageKey = (organizationId: string) => `getting-started-hidden:${organizationId}`;

/**
 * First-run checklist for a new organization. Every step completes itself from
 * real data (a published role, credits, an applicant, a connected calendar),
 * so nobody has to tick anything, and the card disappears once all are done.
 */
export default function GettingStarted({ organizationId, metrics }: { organizationId: string; metrics: StartMetrics }) {
  const [hidden, setHidden] = useState(true);
  const [hasCredits, setHasCredits] = useState<boolean | null>(null);
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(storageKey(organizationId)) === "1");
    } catch {
      setHidden(false);
    }
  }, [organizationId]);

  useEffect(() => {
    let active = true;
    fetch("/api/ella-credits", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.json())
      .then((data) => { if (active && data?.success === true) setHasCredits(Number(data.balance) > 0 || (Array.isArray(data.entries) && data.entries.length > 0)); })
      .catch(() => { if (active) setHasCredits(false); });
    fetch("/api/auth/google-calendar/status", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.json())
      .then((data) => { if (active && data?.success === true) setCalendarConnected(data.connected === true); })
      .catch(() => { if (active) setCalendarConnected(false); });
    return () => { active = false; };
  }, []);

  const steps = useMemo<Step[]>(() => {
    const total = metrics.total ?? 0;
    const published = (metrics.jobPosted ?? 0) > 0;
    return [
      {
        key: "role",
        title: "Create and publish your first role",
        detail: total > 0 && !published ? "You have a role that is not published yet. Open it and publish it so candidates can apply." : "Paste a job description and Smile fills in the screening questions for you. It takes about two minutes.",
        done: published,
        href: total > 0 && !published ? "/roles" : "/roles/new",
        action: total > 0 && !published ? "Open your roles" : "Create a role",
      },
      {
        key: "credits",
        title: "Add Smile credits",
        detail: "Credits pay for screening each resume and for AI phone interviews. Your organization starts with none.",
        done: hasCredits === true,
        href: "/credits",
        action: "Add credits",
      },
      {
        key: "candidates",
        title: "Get your first candidates",
        detail: "Candidates apply through your role's link, or upload a batch of resumes to have them screened right away.",
        done: (metrics.applicantMetrics?.total ?? 0) > 0,
        href: "/resume-screening",
        action: "Add candidates",
      },
      {
        key: "calendar",
        title: "Connect Google Calendar",
        detail: "Only needed for face-to-face interviews. It lets candidates book a time when your HR calendar is free.",
        done: calendarConnected === true,
        optional: true,
        href: "/settings",
        action: "Connect calendar",
      },
    ];
  }, [metrics, hasCredits, calendarConnected]);

  const loaded = hasCredits !== null && calendarConnected !== null;
  const completed = steps.filter((step) => step.done).length;
  const nextKey = steps.find((step) => !step.done)?.key;

  if (hidden || !loaded || completed === steps.length) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(storageKey(organizationId), "1");
    } catch {
      // The card just returns on the next visit if storage is unavailable.
    }
    setHidden(true);
  }

  return (
    <section className="getting-started" aria-labelledby="getting-started-title">
      <div className="getting-started-header">
        <div>
          <span className="dashboard-eyebrow">GETTING STARTED</span>
          <h2 id="getting-started-title">Set up your workspace in {steps.length} steps</h2>
          <p>Follow these in order. Each one checks itself off when it is done.</p>
        </div>
        <div className="getting-started-progress" aria-label={`${completed} of ${steps.length} steps done`}>
          <strong>{completed} of {steps.length}</strong>
          <span className="getting-started-bar"><span style={{ width: `${(completed / steps.length) * 100}%` }} /></span>
        </div>
      </div>
      <ol className="getting-started-steps">
        {steps.map((step, index) => (
          <li key={step.key} className={`getting-started-step${step.done ? " is-done" : ""}${step.key === nextKey ? " is-next" : ""}`}>
            <span className="getting-started-marker" aria-hidden="true">{step.done ? "✓" : index + 1}</span>
            <div className="getting-started-copy">
              <strong>{step.title}{step.optional && <span className="getting-started-optional">Optional</span>}</strong>
              <p>{step.done ? "Done." : step.detail}</p>
            </div>
            {!step.done && <Link className={`btn ${step.key === nextKey ? "btn-primary" : "btn-secondary"}`} href={step.href}>{step.action}</Link>}
          </li>
        ))}
      </ol>
      <button type="button" className="getting-started-hide" onClick={dismiss}>Hide this checklist</button>
    </section>
  );
}
