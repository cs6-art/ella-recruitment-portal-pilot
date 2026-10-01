/**
 * "New applicant" tracking shared by the header bell and the Applicants table.
 *
 * "New" means: submitted after the current user last opened the Applicants
 * page. That watermark is stored per user in localStorage (the portal has no
 * per-user preference store) and is refreshed whenever the Applicants list
 * mounts. Both surfaces compare an applicant's submission time against it.
 *
 * Known limitation (accepted for pilot UAT): because the watermark lives in
 * localStorage, read/unread state is per browser/device and is not synced
 * across a user's devices. A browser with no watermark starts at "now" (no
 * badge) rather than flagging the last week of applicants as new. A server-side per-user watermark is the future
 * improvement; it is intentionally out of scope for the pilot.
 */

const LAST_SEEN_PREFIX = "mclink.applicants.lastSeen.";

/** Fired in this tab whenever the watermark is written, so the sidebar badge
 *  and the header bell (separate hook instances) clear together. The browser's
 *  own `storage` event only reaches *other* tabs. */
export const APPLICANTS_SEEN_EVENT = "mclink:applicants-seen";

function storageKey(email: string | undefined | null) {
  return `${LAST_SEEN_PREFIX}${(email || "anonymous").trim().toLowerCase()}`;
}

export function readApplicantsLastSeen(email: string | undefined | null): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(storageKey(email));
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed)) return parsed;
    // No watermark in this browser yet (a new browser, device or private window,
    // or cleared site data). Start from "now" instead of treating the last week
    // as unseen, otherwise every such login shows a badge for applicants the
    // user has already looked at on another browser.
    const now = Date.now();
    window.localStorage.setItem(storageKey(email), String(now));
    return now;
  } catch {
    // Private mode / disabled storage: no badge rather than a permanent one.
  }
  return Date.now();
}

export function writeApplicantsLastSeen(email: string | undefined | null, whenMs: number = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(email), String(Math.floor(whenMs)));
  } catch {
    // Best effort only; a missed write just re-shows the same "new" rows.
  }
  window.dispatchEvent(new Event(APPLICANTS_SEEN_EVENT));
}

/**
 * Resolve an applicant's submission time to epoch milliseconds. Mirrors the
 * ordering logic in ApplicantsList: prefer the parsed timestamp, fall back to
 * the millis embedded in a generated application ID, and never trust a value
 * that sits more than a few minutes in the future (some legacy rows were
 * written with a local clock but a trailing `Z`).
 */
export function applicantAppliedTime(appliedAt: string, applicationId: string): number {
  const parsed = Date.parse(appliedAt);
  if (Number.isFinite(parsed) && parsed <= Date.now() + 5 * 60 * 1000) return parsed;
  const timestampedId = applicationId.match(/APP-(\d{13})-/i);
  return timestampedId ? Number(timestampedId[1]) : 0;
}

export type RecentApplicant = {
  applicationId: string;
  candidateName: string;
  selectedRole: string;
  appliedAt: string;
};

export function isNewApplicant(
  applicant: { appliedAt: string; applicationId: string; isHistoricalDemo?: boolean },
  lastSeenMs: number,
): boolean {
  if (applicant.isHistoricalDemo) return false;
  return applicantAppliedTime(applicant.appliedAt, applicant.applicationId) > lastSeenMs;
}

/**
 * Keep the sidebar and header notification badges visually consistent with
 * the original portal: counts above nine are intentionally compacted.
 */
export function applicantNotificationBadge(count: number): string {
  return count > 9 ? "9+" : String(Math.max(0, Math.floor(count)));
}

export function hasApplicantNotifications(count: number): boolean {
  return count > 0;
}
