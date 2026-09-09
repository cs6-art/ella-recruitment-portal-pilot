// All user-facing portal timestamps use the shared HR operating timezone.
// Singapore and Manila are both UTC+8; keeping one canonical IANA zone avoids
// browser/server timezone differences in applicant and audit views.
export const PORTAL_TIME_ZONE = "Asia/Singapore";

function parsePortalDate(value: string, dateOnly = false) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatPortalDateTime(value: string, includeTime = true) {
  const parsed = parsePortalDate(value, !includeTime);
  if (!parsed) return value || "Not Provided";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: PORTAL_TIME_ZONE,
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" } : {}),
  }).format(parsed);
}

// Render a stored 24-hour "HH:MM" wall-clock time as a 12-hour label with an
// AM/PM suffix (e.g. "11:40" -> "11:40 AM"). Values that are not a bare
// "HH:MM" are returned unchanged so already-formatted strings pass through.
export function formatPortalClock(value: string) {
  const raw = String(value || "").trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return raw;
  const hours = Number(match[1]);
  const minutes = match[2];
  if (hours > 23 || Number(minutes) > 59) return raw;
  const suffix = hours < 12 ? "AM" : "PM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes} ${suffix}`;
}

export function formatPortalDateKey(value: Date | string) {
  const parsed = value instanceof Date ? value : parsePortalDate(value);
  if (!parsed) return String(value || "");
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PORTAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}
