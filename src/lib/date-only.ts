/**
 * Normalizes the date strings that Google Sheets returns for date-only
 * columns. Sheets commonly returns a locale-formatted value (for example,
 * `8/27/2026`), while HTML date inputs accept only `2026-08-27`.
 */
export function normalizeDateOnly(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";

  // Google Sheets may return a date-only cell as its serial number when the
  // column has mixed formatting. Google uses 1899-12-30 as its serial epoch.
  // Only accept the realistic date range so an arbitrary numeric ID is not
  // accidentally rendered as an interview date.
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (Number.isFinite(serial) && serial >= 20000 && serial <= 100000) {
      const candidate = new Date(Date.UTC(1899, 11, 30) + Math.trunc(serial) * 86400000);
      return `${candidate.getUTCFullYear().toString().padStart(4, "0")}-${(candidate.getUTCMonth() + 1).toString().padStart(2, "0")}-${candidate.getUTCDate().toString().padStart(2, "0")}`;
    }
  }

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  const monthFirst = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s|$)/);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : monthFirst
      ? { year: Number(monthFirst[3].length === 2 ? `20${monthFirst[3]}` : monthFirst[3]), month: Number(monthFirst[1]), day: Number(monthFirst[2]) }
      : null;

  if (parts) {
    const candidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    const valid = candidate.getUTCFullYear() === parts.year
      && candidate.getUTCMonth() === parts.month - 1
      && candidate.getUTCDate() === parts.day;
    if (valid) return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    return text;
  }

  // Date-formatted Sheets cells can also be returned as a month-name string.
  // Parse it only when it is unambiguous and preserve the UTC calendar day.
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    const candidate = new Date(parsed);
    return `${candidate.getUTCFullYear().toString().padStart(4, "0")}-${(candidate.getUTCMonth() + 1).toString().padStart(2, "0")}-${candidate.getUTCDate().toString().padStart(2, "0")}`;
  }
  return text;
}

/** Normalizes Sheets/browser time cells to the HH:mm form used by bookings. */
export function normalizeTimeOnly(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";

  const numeric = Number(text);
  if (/^\d*\.\d+$/.test(text) && Number.isFinite(numeric) && numeric >= 0 && numeric < 1) {
    const totalMinutes = Math.round(numeric * 24 * 60) % (24 * 60);
    return `${Math.floor(totalMinutes / 60).toString().padStart(2, "0")}:${(totalMinutes % 60).toString().padStart(2, "0")}`;
  }

  const match = text.match(/(?:^|[T\s])(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(AM|PM)?(?:Z|[+-]\d{2}:?\d{2})?$/i)
    || text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return "";
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = (match[3] || "").toUpperCase();
  if (meridiem) {
    if (hours < 1 || hours > 12) return "";
    if (meridiem === "PM" && hours !== 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;
  }
  if (hours > 23 || minutes > 59) return "";
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

/** Returns a value safe to assign to <input type="date">. */
export function toDateInputValue(value: unknown): string {
  const normalized = normalizeDateOnly(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}
