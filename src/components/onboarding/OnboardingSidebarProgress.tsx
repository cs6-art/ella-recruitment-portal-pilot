"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import UiIcon from "@/components/UiIcon";
import { stepDefinition } from "@/lib/onboarding";
import { useOnboarding } from "./OnboardingProvider";
import styles from "./Onboarding.module.css";

const STEPS_OPEN_KEY = "smile-onboarding:sidebar-steps";

/**
 * Compact setup progress in the main sidebar, so the next step is always one
 * click away. Reads the same state as the Dashboard checklist.
 */
export default function OnboardingSidebarProgress({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: () => void }) {
  const { state, guidedActive, justCompleted } = useOnboarding();
  const [showSteps, setShowSteps] = useState(true);

  useEffect(() => {
    try { if (window.localStorage.getItem(STEPS_OPEN_KEY) === "closed") setShowSteps(false); } catch { /* storage blocked */ }
  }, []);

  if (!state || !guidedActive || !state.next) return null;
  const current = stepDefinition(state.currentStep);
  const stepNumber = current?.number ?? state.total;
  const ringStyle = { background: `conic-gradient(#0071f7 ${state.percent * 3.6}deg, #d9e6f4 0deg)` };

  if (collapsed) {
    return <Link href={state.next.href} onClick={onNavigate} className={styles.sidebarMini} aria-label={`Continue setup: step ${stepNumber} of ${state.total}, ${current?.short || ""}`} title={`Continue setup: ${current?.short || ""}`}>
      <span className={styles.ring} style={ringStyle}><span>{stepNumber}/{state.total}</span></span>
      Setup
    </Link>;
  }

  const toggle = () => {
    setShowSteps((open) => {
      try { window.localStorage.setItem(STEPS_OPEN_KEY, open ? "closed" : "open"); } catch { /* storage blocked */ }
      return !open;
    });
  };

  return <section className={styles.sidebarSetup} aria-labelledby="sidebar-setup-label">
    <div className={styles.sidebarTop}><span id="sidebar-setup-label" className={styles.sidebarLabel}>Your setup</span><span className={styles.sidebarCount}>Step {stepNumber} of {state.total}</span></div>
    <div className={`${styles.bar} ${styles.sidebarBar}`} role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent}><span style={{ width: `${state.percent}%` }} /></div>
    <p className={styles.sidebarNext}><span>{state.screeningPending ? "In progress:" : "Next:"}</span><strong>{current?.short}</strong></p>
    <Link href={state.next.href} onClick={onNavigate} className={`${styles.cta} ${styles.sidebarCta}`}>Continue Setup<UiIcon name="arrow-right" size={14} /></Link>
    {showSteps && <ol className={styles.sidebarSteps} aria-label="Setup steps">
      {state.steps.map((step) => {
        const cls = step.state === "done" ? styles.sideDone : step.state === "locked" ? styles.sideLocked : styles.sideCurrent;
        return <li key={step.key} className={cls}>
          <span aria-hidden="true">{step.state === "done" ? "✓" : step.state === "locked" ? <UiIcon name="lock" size={9} /> : step.number}</span>
          <span>{step.short}<span className="sr-only"> ({step.state === "done" ? "completed" : step.state === "locked" ? "locked" : "current"}){justCompleted === step.key ? ", just completed" : ""}</span></span>
        </li>;
      })}
    </ol>}
    <button type="button" className={`${styles.linkButton} ${styles.sideToggle}`} onClick={toggle} aria-expanded={showSteps}>{showSteps ? "Hide steps" : "Show steps"}</button>
  </section>;
}
