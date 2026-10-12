"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import UiIcon from "@/components/UiIcon";
import { CORE_STEPS, ONBOARDING_PERMISSION_MESSAGE, type OnboardingNavKey, type OnboardingStepKey } from "@/lib/onboarding";
import { showGuide, type GuideTarget } from "@/lib/onboarding-events";
import { useOnboarding } from "./OnboardingProvider";
import styles from "./Onboarding.module.css";

const LOCKED_COPY: Record<OnboardingNavKey, { title: string; text: string }> = {
  roles: { title: "Role Requests", text: "" },
  "resume-screening": {
    title: "Resume Screening unlocks after your first role is published",
    text: "Resumes are always screened against a published role, so publish your first role before adding resumes. Your setup checklist shows exactly what is left.",
  },
  applicants: {
    title: "Applicants unlocks after your first resume is added",
    text: "Applicants appear here once a resume has been submitted for screening, or a candidate applies through a published role's link.",
  },
};

/**
 * Per-page guidance for the guided setup:
 * - on the page where the current step happens, a short banner with a
 *   "Show me" spotlight button;
 * - on a page whose step is still locked, an explanation in place of the
 *   page's actions (`gate`), with a way back to the current step.
 *
 * This is guidance only. Permissions and workflow prerequisites stay enforced
 * on the server; established organizations never see any of this.
 */
export default function OnboardingPageGuide({ nav, steps, showMe, gate = false, contained = false, children }: {
  nav: OnboardingNavKey;
  /** The steps completed on this page. */
  steps: OnboardingStepKey[];
  showMe?: GuideTarget;
  gate?: boolean;
  /** Wrap the guidance in the page container (for pages whose content renders its own <main>). */
  contained?: boolean;
  children?: ReactNode;
}) {
  const { state, guidedActive } = useOnboarding();
  const wrap = (node: ReactNode) => contained ? <div className="container onboarding-guide-container">{node}</div> : node;
  if (!state || !guidedActive) return <>{children}</>;

  if (state.lockedNav.includes(nav)) {
    const copy = LOCKED_COPY[nav];
    const lock = <section className={styles.gate} aria-labelledby={`onboarding-gate-${nav}`}>
      <h2 id={`onboarding-gate-${nav}`}><span className={styles.gateIcon} aria-hidden="true"><UiIcon name="lock" size={17} /></span>{copy.title}</h2>
      <p>{copy.text}</p>
      {state.next && <Link className={styles.cta} href={state.next.href}>Continue Setup: {state.next.label}<UiIcon name="arrow-right" size={16} /></Link>}
    </section>;
    return gate ? wrap(lock) : <>{wrap(lock)}{children}</>;
  }

  const current = CORE_STEPS.find((step) => step.key === state.currentStep);
  if (!current || !steps.includes(current.key)) return <>{children}</>;
  return <>
    {wrap(<aside className={styles.banner} aria-label="Setup guidance">
      <div>
        <strong>Setup step {current.number} of {state.total}: {current.title}</strong>
        <p>{state.canAct ? current.detail : ONBOARDING_PERMISSION_MESSAGE}</p>
      </div>
      <div className={styles.bannerActions}>
        {showMe && state.canAct && <button type="button" className={styles.ghost} onClick={() => showGuide(showMe)}><UiIcon name="sparkle" size={14} />Show me</button>}
        <Link className={styles.ghost} href="/dashboard">View checklist</Link>
      </div>
    </aside>)}
    {children}
  </>;
}
