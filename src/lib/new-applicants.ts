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
 * across a user's devices. A server-side per-user watermark is the future
 * improvement; it is intentionally out of scope for the pilot.
 */

const LAST_SEEN_PREFIX = "mclink.applicants.lastSeen.";

/** A brand-new install has no watermark; treat anything applied in this
 *  trailing window as new so the first visit still surfaces recent activity. */
const FIRST_VISIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function storageKey(email: string | undefined | null) {
  return `${LAST_SEEN_PREFIX}${(email || "anonymous").trim().toLowerCase()}`;
}

export function readApplicantsLastSeen(email: string | undefined | null): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(storageKey(email));
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  } catch {
    // Private mode / disabled storage — fall through to the first-visit window.
  }
  return Date.now() - FIRST_VISIT_WINDOW_MS;
}

export function writeApplicantsLastSeen(email: string | undefined | null, whenMs: number = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(email), String(Math.floor(whenMs)));
  } catch {
    // Best effort only; a missed write just re-shows the same "new" rows.
  }
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
