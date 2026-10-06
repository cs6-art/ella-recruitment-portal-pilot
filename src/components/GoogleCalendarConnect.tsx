"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import ActionFeedback from "@/components/ActionFeedback";
import GoogleCalendarIcon from "@/components/GoogleCalendarIcon";
import StatusBadge from "@/components/ui/StatusBadge";

type Status = "loading" | "connected" | "mismatch" | "needs_reconnect" | "unavailable" | "not_connected" | "error";
type NoticeKind = "success" | "warning" | "error";

export default function GoogleCalendarConnect({ canManage = false }: { canManage?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [connectedAccountEmail, setConnectedAccountEmail] = useState("");
  const [expectedEmail, setExpectedEmail] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<NoticeKind>("success");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const calendarResult = params.get("calendar");
    const calendarReason = params.get("calendar_reason");
    if (calendarResult) {
      // The callback returns only a safe, human-readable reason; remove both
      // query values after displaying it so they are not retained in history.
      if (calendarResult === "connected") { setNotice("Google Calendar connected."); setNoticeKind("success"); }
      else if (calendarResult === "denied") { setNotice("Google Calendar connection was cancelled."); setNoticeKind("warning"); }
      else { setNotice(calendarReason || "Could not connect Google Calendar. Please try again."); setNoticeKind("error"); }
      const url = new URL(window.location.href);
      url.searchParams.delete("calendar");
      url.searchParams.delete("calendar_reason");
      window.history.replaceState({}, "", url.toString());
    }

    fetch("/api/auth/google-calendar/status")
      .then((res) => res.json())
      .then((data) => {
        setConnectedAccountEmail(typeof data.accountEmail === "string" ? data.accountEmail : "");
        setExpectedEmail(typeof data.expectedEmail === "string" ? data.expectedEmail : "");
        setStatus(!data.success ? "error"
          : data.connected ? "connected"
          : data.accountMismatch ? "mismatch"
          : data.state === "needs_reconnect" ? "needs_reconnect"
          : data.state === "unavailable" ? "unavailable"
          : "not_connected");
      })
      .catch(() => { setStatus("error"); setNotice("Unable to check Google Calendar connection status."); setNoticeKind("error"); });
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/auth/google-calendar/disconnect", { method: "POST" });
      if (res.ok) { setStatus("not_connected"); setConnectedAccountEmail(""); setNotice("Google Calendar disconnected successfully."); setNoticeKind("success"); router.refresh(); }
      else { setNotice("Could not disconnect Google Calendar. Please try again."); setNoticeKind("error"); }
    } finally {
      setDisconnecting(false);
    }
  }

  if (status === "loading") return null;

  return (
    <section className="card calendar-connect-card">
      <div className="card-header">
        <h2>Shared HR Google Calendar</h2>
        {status === "connected" ? <StatusBadge value="Connected" /> : status === "mismatch" ? <StatusBadge value="Account mismatch" /> : status === "needs_reconnect" ? <StatusBadge value="Needs reconnecting" /> : null}
      </div>
      <div className="calendar-connect-body">
        {notice ? <ActionFeedback kind={noticeKind} className="calendar-connect-notice">{notice}</ActionFeedback> : null}
        {status === "connected" ? (
          <>
            <p>Connected account: <strong>{connectedAccountEmail}</strong></p>
            <p>All Face-to-Face interview availability and booking events use this shared HR calendar.</p>
            {canManage && <button type="button" className="btn btn-secondary" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>}
          </>
        ) : status === "mismatch" ? (
          <>
            <p>Connected account: <strong>{connectedAccountEmail}</strong></p>
            <p className="calendar-connect-warning">This account is not being used for Face-to-Face interview bookings because it does not match the shared HR calendar configuration.</p>
            {canManage && <a className="btn btn-primary btn-with-icon" href="/api/auth/google-calendar/connect"><GoogleCalendarIcon />Reconnect Google Calendar</a>}
          </>
        ) : status === "needs_reconnect" ? (
          <>
            <p className="calendar-connect-warning">Google Calendar needs to be reconnected. Its access expired or was removed, so Face-to-Face interview times can&apos;t be offered until it is reconnected. Interviews already booked are still saved in the portal.</p>
            {expectedEmail && <p>Reconnect with the HR calendar account: <strong>{expectedEmail}</strong></p>}
            {canManage ? <a className="btn btn-primary btn-with-icon" href="/api/auth/google-calendar/connect"><GoogleCalendarIcon />Reconnect Google Calendar</a> : <p>Ask a settings administrator to reconnect it.</p>}
          </>
        ) : status === "unavailable" ? (
          <>
            <p className="calendar-connect-warning">Google Calendar can&apos;t be reached right now. This is usually temporary; refresh the page in a few minutes. Interviews already booked are still saved in the portal.</p>
          </>
        ) : (
          <>
            <p>The shared HR Google Calendar is not connected yet.</p>
            {expectedEmail && canManage && <p>Connect with the HR calendar account: <strong>{expectedEmail}</strong>. You can change this account in Settings → &quot;HR calendar account&quot;.</p>}
            {canManage ? <a className="btn btn-primary btn-with-icon" href="/api/auth/google-calendar/connect"><GoogleCalendarIcon />Connect Google Calendar</a> : <p>A settings administrator must connect it before Face-to-Face interview availability can be checked.</p>}
          </>
        )}
      </div>
    </section>
  );
}
