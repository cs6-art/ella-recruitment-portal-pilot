"use client";

import { useEffect, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { clientErrorMessage } from "@/lib/client-error";
import { ROLE_INTERVIEW_TYPE_DESCRIPTIONS, ROLE_INTERVIEW_TYPE_LABELS, ROLE_INTERVIEW_TYPES, type RoleInterviewType } from "@/lib/interview-type";

/** The three Interview type choices as a radio group (role form and role page). */
export function InterviewTypeOptions({ name, value, disabled = false, onChange }: { name: string; value: RoleInterviewType; disabled?: boolean; onChange: (value: RoleInterviewType) => void }) {
  return <div className="interview-type-options" role="radiogroup" aria-label="Interview type">
    {ROLE_INTERVIEW_TYPES.map((option) => (
      <label key={option} className={`interview-type-option${value === option ? " is-selected" : ""}`}>
        <input type="radio" name={name} value={option} checked={value === option} disabled={disabled} onChange={() => onChange(option)} />
        <span><strong>{ROLE_INTERVIEW_TYPE_LABELS[option]}</strong><small>{ROLE_INTERVIEW_TYPE_DESCRIPTIONS[option]}</small></span>
      </label>
    ))}
  </div>;
}

/** Save a role's Interview type through its audited endpoint. */
export async function saveRoleInterviewType(roleId: string, interviewType: RoleInterviewType) {
  const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/interview-type`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interviewType }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to save the interview type.");
  return data.interviewType as RoleInterviewType;
}

type State = { interviewType: RoleInterviewType; editable: boolean };

/**
 * "Interview type" on the role page: which AI interview applicants for this
 * role can be sent. It has its own save so HR can change it while the role is
 * live; the change applies to interviews sent from then on.
 */
export default function InterviewTypeCard({ roleId }: { roleId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [value, setValue] = useState<RoleInterviewType>("both");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/roles/${encodeURIComponent(roleId)}/interview-type`, { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.json().then((data) => (response.ok && data.success ? data as State : null)))
      .then((data) => { if (active && data) { setState(data); setValue(data.interviewType); } })
      .catch(() => undefined);
    return () => { active = false; };
  }, [roleId]);

  // Postgres-only feature: nothing renders until the role's setting loads.
  if (!state) return null;

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveRoleInterviewType(roleId, value);
      setState({ interviewType: saved, editable: true });
      setMessage({ kind: "success", text: `Interview type saved: ${ROLE_INTERVIEW_TYPE_LABELS[saved]}. It applies to interviews sent from now on.` });
    } catch (caught) {
      setMessage({ kind: "error", text: clientErrorMessage(caught, "Unable to save the interview type.") });
    } finally {
      setSaving(false);
    }
  }

  return <section id="interview-type" className="card role-section interview-type-card" aria-labelledby="interview-type-title">
    <div className="card-header interview-automation-header">
      <div>
        <h2 id="interview-type-title">Interview type</h2>
        <p>Choose which AI interview applicants for this role can be sent.</p>
      </div>
      <span className="interview-automation-state is-on">{ROLE_INTERVIEW_TYPE_LABELS[state.interviewType]}</span>
    </div>
    <div className="interview-automation-body">
      <InterviewTypeOptions name={`interview-type-${roleId}`} value={value} disabled={!state.editable || saving} onChange={setValue} />
      <p className="interview-automation-note">Changing this doesn&apos;t affect invitations already sent.{state.editable ? "" : " Only HR can change it."}</p>
      {state.editable && <div className="interview-automation-actions"><button type="button" className="btn btn-primary btn-small" disabled={saving || value === state.interviewType} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button></div>}
      {message && <ActionFeedback kind={message.kind}>{message.text}</ActionFeedback>}
    </div>
  </section>;
}
