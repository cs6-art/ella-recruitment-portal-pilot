"use client";

import { useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { useConfirmation } from "@/components/ConfirmationModal";
import type { InterviewBooking } from "@/lib/candidate-applications";
import { clientErrorMessage } from "@/lib/client-error";

/** Google Calendar sync state of a face-to-face interview, in HR wording. */
export function CalendarSyncBadge({ booking }: { booking: InterviewBooking }) {
  const state = (booking.calendarEventStatus || "").trim().toLowerCase();
  if (state === "created" || state === "updated") return <span className="calendar-sync-badge is-synced">Synced to Google Calendar</span>;
  if (state === "failed") return <span className="calendar-sync-badge is-failed" title="The interview is saved in the portal. Reconnect Google Calendar in Settings if this continues.">Not updated in Google Calendar</span>;
  if (state === "removed") return <span className="calendar-sync-badge">Removed from Google Calendar</span>;
  return null;
}

async function changeInterview(slotId: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/interviews/${encodeURIComponent(slotId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) throw new Error(data.error || "The interview could not be changed.");
  return String(data.message || "Interview updated.");
}

/**
 * Reschedule or cancel a booked face-to-face interview. The portal record
 * always changes; Google Calendar is updated after it, and any sync problem
 * is reported in plain words.
 */
export default function InterviewChangeActions({ booking, onChanged }: { booking: InterviewBooking; onChanged: (message: string) => void }) {
  const { confirm } = useConfirmation();
  const [mode, setMode] = useState<"" | "reschedule">("");
  const [date, setDate] = useState(booking.date);
  const [startTime, setStartTime] = useState(booking.startTime);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function reschedule() {
    setSaving(true);
    setError("");
    try {
      onChanged(await changeInterview(booking.slotId, { action: "reschedule", date, startTime, timezone: booking.timezone }));
    } catch (caught) {
      setError(clientErrorMessage(caught, "The interview could not be rescheduled."));
    } finally {
      setSaving(false);
    }
  }

  async function cancel() {
    if (!(await confirm({
      title: "Cancel this interview?",
      message: `${booking.candidateName || "The candidate"}'s face-to-face interview on ${booking.date} at ${booking.startTime} will be cancelled and removed from Google Calendar. They will be emailed a link to choose a new time.`,
      confirmLabel: "Cancel interview",
      cancelLabel: "Keep interview",
      tone: "danger",
    }))) return;
    setSaving(true);
    setError("");
    try {
      onChanged(await changeInterview(booking.slotId, { action: "cancel", offerNewTime: true }));
    } catch (caught) {
      setError(clientErrorMessage(caught, "The interview could not be cancelled."));
    } finally {
      setSaving(false);
    }
  }

  return <div className="interview-change-actions">
    {mode === "reschedule" ? <div className="interview-reschedule-form">
      <label>New date<input type="date" value={date} disabled={saving} onChange={(event) => setDate(event.target.value)} /></label>
      <label>Start time<input type="time" step={1800} value={startTime} disabled={saving} onChange={(event) => setStartTime(event.target.value)} /></label>
      <small>One hour, {booking.timezone || "Asia/Singapore"}. The new time is checked against the HR Google Calendar.</small>
      <div className="interview-change-buttons">
        <button type="button" className="btn btn-small btn-primary" disabled={saving || !date || !startTime} onClick={() => void reschedule()}>{saving ? "Saving…" : "Save new time"}</button>
        <button type="button" className="btn btn-small btn-secondary" disabled={saving} onClick={() => { setMode(""); setError(""); }}>Back</button>
      </div>
    </div> : <div className="interview-change-buttons">
      <button type="button" className="booking-inline-action" disabled={saving} onClick={() => setMode("reschedule")}>Reschedule</button>
      <button type="button" className="booking-inline-action is-danger" disabled={saving} onClick={() => void cancel()}>{saving ? "Cancelling…" : "Cancel interview"}</button>
    </div>}
    {error && <ActionFeedback kind="error">{error}</ActionFeedback>}
  </div>;
}
