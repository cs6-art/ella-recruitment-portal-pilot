"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import UiIcon from "@/components/UiIcon";
import { showGuide } from "@/lib/onboarding-events";
import { useOnboarding } from "./OnboardingProvider";
import styles from "./Onboarding.module.css";

/**
 * Step 5 of the guided setup, on a screened applicant's page: what to look at
 * in the real screening result, and an explicit "I've reviewed it" that
 * completes the step. No approval, rejection or invitation is required.
 */
export default function ApplicantReviewCoach({ applicationId, screened }: { applicationId: string; screened: boolean }) {
  const { state, guidedActive, post } = useOnboarding();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const previousStep = useRef(state?.currentStep);

  // The result arrived while this page was open: re-render it with the screening.
  useEffect(() => {
    if (previousStep.current === "screen_resume" && state?.currentStep && state.currentStep !== "screen_resume") router.refresh();
    previousStep.current = state?.currentStep;
  }, [state?.currentStep, router]);

  if (!state || !guidedActive) return null;
  if (state.currentStep === "screen_resume") {
    return <aside className={styles.coach} aria-label="Setup guidance">
      <h2><span className={styles.spinner} aria-hidden="true" />Setup step 4 of {state.total}: screening in progress</h2>
      <p className={styles.sampleSummary}>{screened ? "The screening result is in. Your checklist will update in a moment." : "Smile is reading this resume against the role's criteria. This page and your checklist update by themselves when the result is ready."}</p>
    </aside>;
  }
  if (state.currentStep !== "review_applicant" || !screened) return null;

  async function confirm() {
    setSaving(true);
    setError("");
    const result = await post({ action: "acknowledge_review", applicationId });
    if (!result.ok) setError(result.error);
    setSaving(false);
  }

  return <aside className={styles.coach} aria-labelledby="review-coach-title" data-guide-target="review-confirm">
    <h2 id="review-coach-title"><UiIcon name="sparkle" size={16} />Setup step 5 of {state.total}: review your first applicant</h2>
    <ol>
      <li><strong>Match score</strong> – how closely the resume fits the role&apos;s criteria. It helps you prioritise; it is never the decision.</li>
      <li><strong>Summary</strong> – Smile&apos;s short read of the candidate&apos;s background.</li>
      <li><strong>Strengths</strong> and <strong>gaps</strong> – what supports the fit and what to check in an interview.</li>
      <li><strong>Evidence</strong> – the role settings Smile applied, under &quot;How AI Graded This Applicant&quot;.</li>
      <li><strong>Next actions</strong> – approve, reject or send an interview, when you are ready. Sample candidates are never contacted.</li>
    </ol>
    <div className={styles.coachActions}>
      <button type="button" className={styles.ghost} onClick={() => showGuide("review-results")}><UiIcon name="search" size={14} />Show me what to review</button>
      {/* The server checks the reviewer's access and that this applicant really has a screening result. */}
      <button type="button" className={styles.cta} disabled={saving} onClick={() => void confirm()}><UiIcon name="check" size={15} />{saving ? "Saving…" : "I've reviewed this screening"}</button>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </aside>;
}
