"use client";

import { useEffect, useState } from "react";

type Interviewer = { email: string; name: string; calendarConnected: boolean };

/**
 * Chooses whose Google Calendar hosts a role's face-to-face interviews.
 * Saves immediately (separate from the rest of Recruitment Setup) because the
 * assignment is applied to the role, not to the setup draft.
 */
export default function RoleInterviewerPicker({ roleId, editable }: { roleId: string; editable: boolean }) {
  const [interviewers, setInterviewers] = useState<Interviewer[]>([]);
  const [sharedEmail, setSharedEmail] = useState("");
  const [assigned, setAssigned] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/interviewers?roleId=${encodeURIComponent(roleId)}`, { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!active || data?.success !== true) return;
        setInterviewers(Array.isArray(data.interviewers) ? data.interviewers : []);
        setSharedEmail(String(data.sharedCalendarEmail || ""));
        setAssigned(String(data.assignedEmail || ""));
      })
      .catch(() => undefined)
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [roleId]);

  async function choose(email: string) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/interviewer`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success !== true) throw new Error(data?.error || "Unable to assign the interviewer.");
      setAssigned(String(data.assignedEmail || ""));
      setMessage({ kind: "ok", text: email ? "Interviewer assigned. New bookings use their calendar." : "Back to the shared HR calendar." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to assign the interviewer." });
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;
  return (
    <div className="field">
      <label htmlFor="role-interviewer">Face-to-face interviewer</label>
      <select id="role-interviewer" value={assigned} disabled={!editable || saving} onChange={(event) => void choose(event.target.value)}>
        <option value="">Shared HR calendar{sharedEmail ? ` (${sharedEmail})` : ""}</option>
        {interviewers.map((person) => (
          <option key={person.email} value={person.email} disabled={!person.calendarConnected && person.email !== assigned}>
            {person.name}{person.calendarConnected ? "" : " — calendar not connected"}
          </option>
        ))}
      </select>
      <small className="field-help">Interviews are created on this person&apos;s Google Calendar and only their free times are offered. Interviewers connect their own calendar from their Profile page.</small>
      {message && <small className="field-help" role="status" style={{ color: message.kind === "error" ? "#b42318" : "#067647" }}>{message.text}</small>}
    </div>
  );
}
