"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { useConfirmation } from "@/components/ConfirmationModal";
import { clientErrorMessage } from "@/lib/client-error";
import { smileSay } from "@/lib/smile-say";
import { formatPortalDateTime } from "@/lib/portal-time";

type Automation = { enabled: boolean; minScore: number; enabledAt: string; enabledBy: string };
type AutomationResponse = { success?: boolean; error?: string; automation?: Automation; waitingForReview?: number; roleOpen?: boolean; roleLive?: boolean };
const AUTOMATION_UPDATED_EVENT = "smile:interview-automation-updated";

/**
 * Role-level "Interview automation": applicants whose screening score meets
 * the minimum are invited to interview without waiting for HR. It has its own
 * save action so HR can change it while the role is live.
 */
export default function InterviewAutomationCard({ roleId, editable, placement = "details" }: { roleId: string; editable: boolean; placement?: "details" | "setup" }) {
  const { confirm } = useConfirmation();
  const [state, setState] = useState<AutomationResponse | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [minScore, setMinScore] = useState("80");
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  function apply(data: AutomationResponse) {
    setState(data);
    if (data.automation) {
      setEnabled(data.automation.enabled);
      setMinScore(String(data.automation.minScore));
    }
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/roles/${encodeURIComponent(roleId)}/interview-automation`, { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.json().then((data: AutomationResponse) => (response.ok && data.success ? data : null)))
      .then((data) => { if (active && data) apply(data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [roleId]);

  useEffect(() => {
    function syncOtherAutomationCards(event: Event) {
      const detail = (event as CustomEvent<{ roleId: string; data: AutomationResponse }>).detail;
      if (detail?.roleId !== roleId || !detail.data.automation) return;
      setState(detail.data);
      setEnabled(detail.data.automation.enabled);
      setMinScore(String(detail.data.automation.minScore));
    }
    window.addEventListener(AUTOMATION_UPDATED_EVENT, syncOtherAutomationCards);
    return () => window.removeEventListener(AUTOMATION_UPDATED_EVENT, syncOtherAutomationCards);
  }, [roleId]);

  // Postgres-only feature: nothing renders until the role's setting loads.
  if (!state?.automation) return null;
  const saved = state.automation;
  const waiting = state.waitingForReview || 0;
  const dirty = enabled !== saved.enabled || (enabled && Number(minScore) !== saved.minScore);
  const canChange = editable && (state.roleOpen || saved.enabled);

  async function save() {
    const score = Number(minScore);
    if (!Number.isInteger(score) || score < 1 || score > 100) {
      setMessage({ kind: "error", text: "Enter a minimum score from 1 to 100." });
      return;
    }
    if (enabled && !saved.enabled && !(await confirm({
      title: "Switch on Interview automation?",
      message: `Applicants screened from now on who score ${score}% or more will be invited to interview automatically, and they will receive the invitation email. Applicants already waiting stay in HR review.`,
      confirmLabel: "Switch on",
    }))) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/interview-automation`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, minScore: score }),
      });
      const data: AutomationResponse = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || "Unable to save Interview automation.");
      apply(data);
      window.dispatchEvent(new CustomEvent(AUTOMATION_UPDATED_EVENT, { detail: { roleId, data } }));
      setMessage({ kind: "success", text: enabled ? "Interview automation is on." : "Interview automation is off. New applicants wait for HR review." });
      smileSay(enabled ? `Automation is on. Applicants I screen from now on who score ${score}% or more are invited automatically.` : "Automation is off. New applicants wait for your review.", cardRef.current);
    } catch (caught) {
      setMessage({ kind: "error", text: clientErrorMessage(caught, "Unable to save Interview automation.") });
    } finally {
      setSaving(false);
    }
  }

  const reviewHref = `/roles/${encodeURIComponent(roleId)}/applicants?stage=${encodeURIComponent("Resume Review")}&sort=match`;
  const setupPlacement = placement === "setup";
  return <section ref={cardRef} id={setupPlacement ? "recruitment-setup-interview-automation" : "interview-automation"} className={`card role-section interview-automation-card${setupPlacement ? " interview-automation-card-in-setup" : ""}`} aria-labelledby={setupPlacement ? "recruitment-setup-interview-automation-title" : "interview-automation-title"}>
    <div className="card-header interview-automation-header">
      <div>
        <h2 id={setupPlacement ? "recruitment-setup-interview-automation-title" : "interview-automation-title"}>Interview automation</h2>
        <p>Invite applicants to interview automatically when their screening score meets a minimum.</p>
      </div>
      <span className={`interview-automation-state ${saved.enabled ? "is-on" : "is-off"}`}>{saved.enabled ? `On · ${saved.minScore}%+` : "Off"}</span>
    </div>
    <div className="interview-automation-body">
      <label className="interview-automation-switch">
        <input type="checkbox" role="switch" checked={enabled} disabled={!canChange || saving} onChange={(event) => setEnabled(event.target.checked)} />
        <span>Automatically invite applicants scoring at least</span>
        <input type="number" inputMode="numeric" min={1} max={100} step={1} aria-label="Minimum screening score" value={minScore} disabled={!canChange || saving || !enabled} onChange={(event) => setMinScore(event.target.value)} />
        <span>%</span>
      </label>
      <p className="interview-automation-note">
        {saved.enabled
          ? <>On since {formatPortalDateTime(saved.enabledAt, false)}{saved.enabledBy ? ` by ${saved.enabledBy}` : ""}. Applies only to applicants screened since then; everyone else stays in HR review.</>
          : state.roleOpen ? "Off. Every applicant waits for HR review." : "Not available for a rejected role or one past its target hiring date."}
        {state.roleOpen && !state.roleLive && " This role isn't live yet: the condition starts working once it is approved and published, and applicants are screened."}
      </p>
      {waiting > 0 && <p className="interview-automation-waiting">{waiting} {waiting === 1 ? "applicant is" : "applicants are"} waiting for review. <Link href={reviewHref}>Review them →</Link></p>}
      {editable && canChange && <div className="interview-automation-actions"><button type="button" className="btn btn-primary btn-small" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button></div>}
      {message && <ActionFeedback kind={message.kind}>{message.text}</ActionFeedback>}
    </div>
  </section>;
}
