"use client";

import Link from "next/link";
import { useState } from "react";

import UiIcon from "@/components/UiIcon";
import { ONBOARDING_PERMISSION_MESSAGE, type OnboardingStepView } from "@/lib/onboarding";
import { useOnboarding } from "./OnboardingProvider";
import styles from "./Onboarding.module.css";

function StepMarker({ step }: { step: OnboardingStepView }) {
  if (step.state === "done") return <span className={styles.marker} aria-hidden="true"><UiIcon name="check" size={16} /></span>;
  if (step.state === "locked") return <span className={styles.marker} aria-hidden="true"><UiIcon name="lock" size={15} /></span>;
  if (step.state === "waiting") return <span className={styles.marker} aria-hidden="true"><span className={styles.spinner} /></span>;
  return <span className={styles.marker} aria-hidden="true">{step.number}</span>;
}

const STATE_LABEL: Record<OnboardingStepView["state"], string> = {
  done: "Completed",
  current: "Current step",
  waiting: "In progress",
  locked: "Locked",
};

/**
 * The Dashboard's guided-setup card for a new organization. Progress comes
 * from the organization's real records (see lib/onboarding.ts) and updates
 * without a refresh; when the five core steps are done it shrinks to a small
 * "ready" card that can be dismissed.
 */
export default function OnboardingChecklist() {
  const { state, loaded, justCompleted, post } = useOnboarding();
  const [dismissing, setDismissing] = useState(false);

  if (!loaded || !state || state.mode !== "guided") return null;

  if (state.status === "completed") {
    if (!state.showCompletionCard) return null;
    return <section className={styles.complete} aria-labelledby="onboarding-complete-title">
      <div>
        <span className={styles.eyebrow}><UiIcon name="check-circle" size={14} />Setup complete</span>
        <h2 id="onboarding-complete-title">You&apos;re ready to recruit with Smile!</h2>
        <p>Your team has created and published a role, screened a resume and reviewed an applicant.</p>
      </div>
      <div className={styles.completeActions}>
        {state.canAct && <Link className={styles.cta} href="/roles/new"><UiIcon name="plus" size={16} />Create another role</Link>}
        <Link className={styles.ghost} href="/applicants">Review applicants</Link>
        <Link className={styles.ghost} href="/manual#h-interviews">Explore AI interviews</Link>
        <button type="button" className={styles.linkButton} disabled={dismissing} onClick={async () => { setDismissing(true); await post({ action: "dismiss_completion" }); setDismissing(false); }}>{dismissing ? "Hiding…" : "Hide"}</button>
      </div>
    </section>;
  }

  const current = state.steps.find((step) => step.key === state.currentStep);
  const stepNumber = current?.number ?? state.total;
  const fresh = state.status === "not_started";

  return <section className={styles.checklist} aria-labelledby="onboarding-title" data-onboarding-checklist>
    <div className={styles.checklistHeader}>
      <div>
        <span className={styles.eyebrow}><UiIcon name="sparkle" size={13} />Your recruitment setup</span>
        <h2 id="onboarding-title">{fresh ? "Welcome to Smile!" : "Let's finish your first recruitment workflow"}</h2>
        <p>{fresh ? "Let's set up your first recruitment workflow. Each step unlocks the next one." : "Pick up where your team left off. Progress is shared by everyone in your organization."}</p>
      </div>
      <div className={styles.progressBlock}>
        <div className={styles.progressTop}><strong>Step {stepNumber} of {state.total}</strong><span>{state.percent}%</span></div>
        <div className={styles.bar} role="progressbar" aria-label="Recruitment setup progress" aria-valuemin={0} aria-valuemax={state.total} aria-valuenow={state.completedCount} aria-valuetext={`${state.completedCount} of ${state.total} steps complete`}><span style={{ width: `${state.percent}%` }} /></div>
        <span className={styles.progressNote}>{state.completedCount} of {state.total} complete · updates automatically</span>
      </div>
    </div>

    <ol className={styles.steps}>
      {state.steps.map((step) => {
        const isCurrent = step.state === "current" || step.state === "waiting";
        const className = [styles.step, step.state === "done" ? styles.stepDone : "", step.state === "current" ? styles.stepCurrent : "", step.state === "waiting" ? styles.stepWaiting : "", step.state === "locked" ? styles.stepLocked : "", justCompleted === step.key ? styles.justDone : ""].filter(Boolean).join(" ");
        return <li key={step.key} className={className} aria-current={isCurrent ? "step" : undefined}>
          <StepMarker step={step} />
          <div className={styles.stepCopy}>
            <strong>{step.number}. {step.title}</strong>
            <p>{step.state === "locked" ? step.lockedReason : step.state === "waiting" ? "Smile is screening the resume now. The result usually appears within a few minutes; this checklist updates by itself." : step.detail}</p>
            <span className={styles.stepState}>{step.state === "locked" && <UiIcon name="lock" size={12} />}{STATE_LABEL[step.state]}</span>
          </div>
          {isCurrent && state.next && <div className={styles.stepActions}>
            {state.canAct || step.state === "waiting"
              ? <Link className={styles.cta} href={state.next.href}>{state.next.label}<UiIcon name="arrow-right" size={16} /></Link>
              : <span className={styles.cta} aria-disabled="true">{state.next.label}</span>}
          </div>}
        </li>;
      })}
    </ol>

    {!state.canAct && <p className={styles.permission} role="note"><UiIcon name="info" size={16} />{ONBOARDING_PERMISSION_MESSAGE}</p>}

    <details className={styles.optional}>
      <summary>Optional next steps after setup</summary>
      <div className={styles.optionalGrid}>
        {state.optional.map((item) => <div key={item.key} className={styles.optionalCard}>
          <strong>{item.title}</strong>
          <span className={styles.optionalStatus}>{item.status}</span>
          <p>{item.detail}</p>
          <ul>{item.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul>
          <div className={styles.optionalActions}><Link className={styles.ghost} href={item.action.href}>{item.action.label}</Link><Link className={styles.linkButton} href={item.learnMore}>Learn how</Link></div>
        </div>)}
      </div>
    </details>
    <div className={styles.footer}><span>Sample candidates are never emailed, called or invited. Screening a resume uses 1 Smile Credit.</span><Link href="/manual#a-quick-start">Explore Manual</Link></div>
  </section>;
}
