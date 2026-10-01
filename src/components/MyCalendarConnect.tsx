"use client";

import { useEffect, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import StatusBadge from "@/components/ui/StatusBadge";

type Notice = { kind: "success" | "warning" | "error"; text: string } | null;

/** Lets an HR reviewer connect their own Google Calendar so they can be assigned as a role's interviewer. */
export default function MyCalendarConnect({ email }: { email: string }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("calendar");
    if (result) {
      if (result === "connected") setNotice({ kind: "success", text: "Your Google Calendar is connected." });
      else if (result === "denied") setNotice({ kind: "warning", text: "Google Calendar connection was cancelled." });
      else setNotice({ kind: "error", text: params.get("calendar_reason") || "Could not connect Google Calendar. Please try again." });
      const url = new URL(window.location.href);
      url.searchParams.delete("calendar");
      url.searchParams.delete("calendar_reason");
      window.history.replaceState({}, "", url.toString());
    }
    fetch("/api/auth/google-calendar/status?self=1", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setConnected(data?.success === true && data.connected === true))
      .catch(() => { setConnected(false); setNotice({ kind: "error", text: "Unable to check your calendar connection." }); });
  }, []);

  async function disconnect() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/google-calendar/disconnect?self=1", { method: "POST", credentials: "same-origin" });
      if (response.ok) { setConnected(false); setNotice({ kind: "success", text: "Your Google Calendar was disconnected." }); }
      else setNotice({ kind: "error", text: "Could not disconnect your calendar. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card role-section" aria-labelledby="my-calendar-title">
      <div className="card-header"><h2 id="my-calendar-title">My Google Calendar</h2></div>
      <div className="role-section-body">
        <p>Connect the Google account <strong>{email}</strong> so HR can assign you as the interviewer for face-to-face interviews. Interviews assigned to you are created on your calendar, and only times when you are free are offered to candidates.</p>
        {notice && <ActionFeedback kind={notice.kind}>{notice.text}</ActionFeedback>}
        {connected === null ? <p>Checking connection…</p> : connected ? (
          <p><StatusBadge value="Connected" />{" "}<button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => void disconnect()}>{busy ? "Disconnecting…" : "Disconnect"}</button></p>
        ) : (
          <p><a className="btn btn-primary" href="/api/auth/google-calendar/connect?self=1">Connect My Google Calendar</a></p>
        )}
      </div>
    </section>
  );
}
