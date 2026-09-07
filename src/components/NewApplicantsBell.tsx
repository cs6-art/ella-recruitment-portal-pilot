"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import UiIcon from "./UiIcon";
import styles from "./NewApplicantsBell.module.css";
import { useSharedPoll } from "@/lib/client-poll";
import { formatPortalDateTime } from "@/lib/portal-time";
import {
  applicantAppliedTime,
  applicantNotificationBadge,
  hasApplicantNotifications,
  readApplicantsLastSeen,
  type RecentApplicant,
} from "@/lib/new-applicants";

const POLL_KEY = "applicants-recent";
const POLL_INTERVAL_MS = 60_000;

async function fetchRecentApplicants(): Promise<RecentApplicant[] | null> {
  const response = await fetch("/api/applicants/recent", { credentials: "same-origin" });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  return data?.success && Array.isArray(data.applicants) ? (data.applicants as RecentApplicant[]) : null;
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

  const { data, refresh } = useSharedPoll<RecentApplicant[]>(POLL_KEY, fetchRecentApplicants, POLL_INTERVAL_MS, enabled);
  const recent = useMemo(() => (enabled ? data ?? [] : []), [enabled, data]);
  const load = useCallback(() => { void refresh(); }, [refresh]);

  // Re-read the watermark on navigation (and shortly after, so a visit to
  // /applicants that writes it on mount is picked up) and on storage events
  // from other tabs.
  useEffect(() => {
    const sync = () => setLastSeen(readApplicantsLastSeen(userEmail));
    sync();
    const timer = window.setTimeout(sync, 800);
    window.addEventListener("storage", sync);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("storage", sync);
    };
  }, [pathname, userEmail]);

  const newApplicants = useMemo(
    () => recent.filter((applicant) => applicantAppliedTime(applicant.appliedAt, applicant.applicationId) > lastSeen),
    [recent, lastSeen],
  );
  return {
    recent,
    newApplicants,
    count: newApplicants.length,
    badge: applicantNotificationBadge(newApplicants.length),
    hasNotifications: hasApplicantNotifications(newApplicants.length),
    reload: load,
  };
}

export default function NewApplicantsBell({ userEmail }: { userEmail?: string }) {
  const { newApplicants, count, badge } = useNewApplicantFeed(userEmail);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
            <span>{count > 0 ? `${count} since your last visit` : "You're all caught up"}</span>
          </div>
          {count === 0 ? (
            <p className={styles.empty}>No new applicants since you last opened the Applicants page.</p>
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
