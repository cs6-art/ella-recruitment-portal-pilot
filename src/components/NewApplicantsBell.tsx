"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import UiIcon from "./UiIcon";
import styles from "./NewApplicantsBell.module.css";
import { formatPortalDateTime } from "@/lib/portal-time";
import {
  applicantAppliedTime,
  readApplicantsLastSeen,
  type RecentApplicant,
} from "@/lib/new-applicants";

const POLL_INTERVAL_MS = 60_000;

/**
 * Header bell that surfaces applicants submitted since the current user last
 * opened the Applicants page. The watermark is written by ApplicantsList; this
 * component only reads it, re-reading whenever the route changes so the count
 * clears right after a visit.
 */
export default function NewApplicantsBell({ userEmail }: { userEmail?: string }) {
  const pathname = usePathname();
  const [recent, setRecent] = useState<RecentApplicant[]>([]);
  const [lastSeen, setLastSeen] = useState<number>(() => readApplicantsLastSeen(userEmail));
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/applicants/recent", { credentials: "same-origin" });
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      if (data?.success && Array.isArray(data.applicants)) setRecent(data.applicants);
    } catch {
      // Transient network failure — keep the last known list.
    }
  }, []);

  useEffect(() => {
    void load();
    // Skip the interval fetch while the tab is hidden; the focus listener
    // refreshes as soon as the user returns.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_INTERVAL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

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

  const newApplicants = useMemo(
    () => recent.filter((applicant) => applicantAppliedTime(applicant.appliedAt, applicant.applicationId) > lastSeen),
    [recent, lastSeen],
  );
  const count = newApplicants.length;

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
        {count > 0 && <span className={styles.badge}>{count > 99 ? "99+" : count}</span>}
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
