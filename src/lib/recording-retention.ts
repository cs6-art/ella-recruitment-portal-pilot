/**
 * How long an organization keeps Live Avatar interview recordings. Each
 * organization may choose its own period; when it hasn't, the platform default
 * (INTERVIEW_RECORDING_RETENTION_DAYS, 90 when unset) applies. Kept free of
 * imports so the Settings card, the API route, the purge job and the tests all
 * use the same limits.
 */

export const RECORDING_RETENTION_MIN_DAYS = 7;
export const RECORDING_RETENTION_MAX_DAYS = 365;

/** Null means "use the platform default". Anything else must be a whole number of days in range. */
export function normalizeRecordingRetentionDays(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  const days = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(days) || days < RECORDING_RETENTION_MIN_DAYS || days > RECORDING_RETENTION_MAX_DAYS) {
    throw new RangeError(`Keep recordings for ${RECORDING_RETENTION_MIN_DAYS} to ${RECORDING_RETENTION_MAX_DAYS} days, or leave it blank to use the platform default.`);
  }
  return days;
}

/** The organization's own period when it has one, otherwise the platform default. */
export function recordingRetentionDaysFor(organizationDays: number | null | undefined, platformDays: number): number {
  return organizationDays ?? platformDays;
}
