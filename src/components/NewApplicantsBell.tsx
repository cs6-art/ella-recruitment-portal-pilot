"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import UiIcon from "./UiIcon";
import styles from "./NewApplicantsBell.module.css";
import { refreshSharedPoll, useSharedPoll } from "@/lib/client-poll";
import { formatPortalDateTime } from "@/lib/portal-time";
import {
  APPLICANTS_SEEN_EVENT,
  applicantAppliedTime,
  applicantNotificationBadge,
  hasApplicantNotifications,
  readApplicantsLastSeen,
  type RecentApplicant,
  writeApplicantsLastSeen,
} from "@/lib/new-applicants";

export const APPLICANT_FEED_POLL_KEY = "applicants-recent";
const POLL_KEY = APPLICANT_FEED_POLL_KEY;
const POLL_INTERVAL_MS = 5 * 60_000;

/**
 * `serverReadState` feeds (Postgres) already contain only this user's unseen
 * applicants, with read state stored per user on the server. The legacy
 * Sheets feed returns recent applicants and the browser watermark decides.
 */
type ApplicantFeed = { serverReadState: boolean; total: number; applicants: RecentApplicant[] };

async function fetchRecentApplicants(): Promise<ApplicantFeed | null> {
  const response = await fetch("/api/applicants/recent", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  if (!data?.success || !Array.isArray(data.applicants)) return null;
  const applicants = data.applicants as RecentApplicant[];
  return { serverReadState: data.serverReadState === true, total: Number(data.total) || applicants.length, applicants };
}

/** "Mark all as read" for the signed-in user only, then refresh every badge. */
export async function markAllApplicantsRead(userEmail?: string) {
  const response = await fetch("/api/notifications/applicants/read-all", { method: "POST", credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to mark applicants as read.");
  // Legacy (Sheets) mode keeps its browser watermark in step.
  if (data.recorded !== true) writeApplicantsLastSeen(userEmail);
  refreshSharedPoll(POLL_KEY);
}

/**
 * Header bell that surfaces applicants submitted since the current user last
 * opened the Applicants page. The watermark is written by ApplicantsList; this
 * component only reads it, re-reading whenever the route changes so the count
 * clears right after a visit.
 *
 * Both callers (the sidebar nav badge and the header bell) share ONE poll of
 * the recent-applicants endpoint via `useSharedPoll`, which is visibility-aware
 * and pauses when no caller is mounted.
 */
export function useNewApplicantFeed(userEmail?: string, enabled = true) {
  const pathname = usePathname();
  const [lastSeen, setLastSeen] = useState<number>(() => readApplicantsLastSeen(userEmail));

  const { data, refresh } = useSharedPoll<ApplicantFeed>(POLL_KEY, fetchRecentApplicants, POLL_INTERVAL_MS, enabled);
  const serverReadState = enabled && data?.serverReadState === true;
  const recent = useMemo(() => (enabled ? data?.applicants ?? [] : []), [enabled, data]);
  const load = useCallback(() => { void refresh(); }, [refresh]);

  // Re-read the watermark on navigation (and shortly after, so a visit to
  // /applicants that writes it on mount is picked up) and on storage events
  // from other tabs.
  useEffect(() => {
    const sync = () => setLastSeen(readApplicantsLastSeen(userEmail));
    sync();
    const timer = window.setTimeout(sync, 800);
    window.addEventListener("storage", sync);
    window.addEventListener(APPLICANTS_SEEN_EVENT, sync);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("storage", sync);
      window.removeEventListener(APPLICANTS_SEEN_EVENT, sync);
    };
  }, [pathname, userEmail]);

  const newApplicants = useMemo(
    () => serverReadState ? recent : recent.filter((applicant) => applicantAppliedTime(applicant.appliedAt, applicant.applicationId) > lastSeen),
    [recent, lastSeen, serverReadState],
  );
  const count = serverReadState ? data?.total ?? newApplicants.length : newApplicants.length;
  return {
    recent,
    newApplicants,
    serverReadState,
    count,
    badge: applicantNotificationBadge(count),
    hasNotifications: hasApplicantNotifications(count),
    reload: load,
  };
}

export default function NewApplicantsBell({ userEmail }: { userEmail?: string }) {
  const { newApplicants, count, badge, serverReadState } = useNewApplicantFeed(userEmail);
  const [open, setOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [markError, setMarkError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  // Legacy (Sheets) mode only: closing the panel counts as seeing the list.
  // With server read state an applicant stops being new only once opened, or
  // through "Mark all as read".
  useEffect(() => {
    if (!serverReadState && wasOpen.current && !open) writeApplicantsLastSeen(userEmail);
    wasOpen.current = open;
  }, [open, serverReadState, userEmail]);

  async function markAll() {
    setMarkingAll(true);
    setMarkError("");
    try {
      await markAllApplicantsRead(userEmail);
    } catch (error) {
      setMarkError(error instanceof Error ? error.message : "Unable to mark applicants as read.");
    } finally {
      setMarkingAll(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.bell} ref={containerRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={count > 0 ? `${count} new applicant${count === 1 ? "" : "s"}` : "New applicants"}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <UiIcon name="bell" size={20} />
        {count > 0 && <span className={styles.badge}>{badge}</span>}
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label="New applicants">
          <div className={styles.panelHeader}>
            <strong>New applicants</strong>
            <span>{count > 0 ? `${count} you haven't opened yet` : "You're all caught up"}</span>
            {count > 0 && <button type="button" className={styles.markAll} disabled={markingAll} onClick={() => void markAll()}>{markingAll ? "Marking…" : "Mark all as read"}</button>}
          </div>
          {markError && <p className={styles.error} role="alert">{markError}</p>}
          {count === 0 ? (
            <p className={styles.empty}>No new applicants. New ones appear here until you open them.</p>
          ) : (
            <ul className={styles.list}>
              {newApplicants.slice(0, 12).map((applicant) => (
                <li key={applicant.applicationId}>
                  <Link href={`/applicants/${encodeURIComponent(applicant.applicationId)}`} onClick={() => setOpen(false)}>
                    <strong>{applicant.candidateName || "Unnamed candidate"}</strong>
                    <span>{applicant.selectedRole || "Role not provided"}</span>
                    <small>{formatPortalDateTime(applicant.appliedAt, false)}</small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link className={styles.viewAll} href="/applicants" onClick={() => setOpen(false)}>
            View all applicants
          </Link>
        </div>
      )}
    </div>
  );
}
