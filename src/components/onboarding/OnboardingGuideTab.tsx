"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { ONBOARDING_PERMISSION_MESSAGE, stepDefinition } from "@/lib/onboarding";
import { showGuide, type GuideTarget } from "@/lib/onboarding-events";
import { useOnboarding } from "./OnboardingProvider";
import styles from "../HelpBot.module.css";
import onboardingStyles from "./Onboarding.module.css";

type GuideButton = { label: string; target: GuideTarget; href?: string };

/** Fixed, step-aware buttons. Smile's free-text answers are never needed to move forward. */
function buttonsFor(path: string, step: string | null): GuideButton[] {
  if (step === "create_role") {
    if (path === "/roles/new" || /^\/roles\/[^/]+\/edit$/.test(path)) return [
      { label: "Choose Sample JD", target: "sample-jd" },
      { label: "Upload Job Description", target: "jd-upload" },
      { label: "Generate AI questions", target: "generate-ai" },
    ];
    return [{ label: "Start with Role Request", target: "sample-jd", href: "/roles/new" }];
  }
  if (step === "publish_role" && path.startsWith("/roles/")) return [
    { label: "Show me what to review", target: "review-setup" },
    { label: "Show me where to publish", target: "publish-role" },
  ];
  if (step === "add_candidate") {
    if (path === "/resume-screening") return [
      { label: "Choose Sample Resume", target: "sample-resume" },
      { label: "Upload Resume", target: "resume-upload" },
      { label: "Show me the Screen button", target: "screen-submit" },
    ];
    return [{ label: "Choose Sample Resume", target: "sample-resume", href: "/resume-screening" }];
  }
  if (step === "review_applicant" && /^\/applicants\/[^/]+$/.test(path)) return [
    { label: "View Screening Result", target: "review-results" },
    { label: "Show Me What to Review", target: "review-confirm" },
  ];
  return [];
}

/**
 * Smile's "Setup" tab: where the organization is in the guided journey and
 * one-click buttons that take the user to the right place and spotlight the
 * control to use. Reads only setup progress, never candidate records.
 */
export default function OnboardingGuideTab({ onClose }: { onClose: () => void }) {
  const { state } = useOnboarding();
  const pathname = usePathname() || "";
  const router = useRouter();

  if (!state || state.mode !== "guided") return null;

  if (state.status === "completed") {
    return <div className={styles.helpTab}>
      <div className={styles.helpCard}>
        <strong>You&apos;re ready to recruit with Smile!</strong>
        <p>Your team finished the guided setup. Next, explore AI interviews: choose Voice, Live Avatar or both on a role, then send an interview from an applicant&apos;s page. Sample candidates are never contacted.</p>
        <div className={styles.helpActions}>
          <Link className={styles.secondaryButton} href="/roles/new" onClick={onClose}>Create another role</Link>
          <Link className={styles.secondaryButton} href="/manual#h-interviews" onClick={onClose}>Learn about interviews</Link>
        </div>
      </div>
    </div>;
  }

  const step = stepDefinition(state.currentStep);
  const buttons = buttonsFor(pathname, state.currentStep);
  const go = (button: GuideButton) => {
    onClose();
    if (button.href && button.href !== pathname) router.push(`${button.href}?guide=${button.target}`);
    else window.setTimeout(() => showGuide(button.target), 120);
  };

  return <div className={styles.helpTab}>
    <div className={styles.helpCard}>
      <strong>Setup step {step?.number} of {state.total}: {step?.title}</strong>
      <div className={`${onboardingStyles.bar} ${onboardingStyles.sidebarBar}`} role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent}><span style={{ width: `${state.percent}%` }} /></div>
      <p>{state.canAct ? step?.smileIntro : ONBOARDING_PERMISSION_MESSAGE}</p>
      {state.canAct && buttons.length > 0 && <div className={styles.helpActions}>
        {buttons.map((button) => <button key={button.label} type="button" className={styles.secondaryButton} onClick={() => go(button)}>{button.label}</button>)}
      </div>}
      {state.next && <div className={styles.helpActions}>
        <Link className={styles.secondaryButton} href={state.next.href} onClick={onClose}>Continue Setup: {state.next.label}</Link>
      </div>}
    </div>
    <p className={styles.srStatus} role="status">{state.completedCount} of {state.total} setup steps complete.</p>
  </div>;
}
