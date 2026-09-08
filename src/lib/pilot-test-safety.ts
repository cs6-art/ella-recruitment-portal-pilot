/**
 * Pilot-only outbound safety boundaries.
 *
 * The Postgres recruitment target is used only by the Pilot deployment during
 * this validation phase. Its email and voice integrations must therefore be
 * safe by construction: candidate mail uses the Postgres applicant address
 * with explicit internal monitoring copies, and voice dispatch remains
 * dry-run unless the Pilot explicitly opts into live mode.
 */
export const PILOT_TEST_EMAIL = "cs6@mclinkgroup.com";
export const PILOT_INTERNAL_EMAIL_COPIES = ["cs6@mclinkgroup.com", "cs9@mclinkgroup.com"] as const;

function isTrue(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function isFalse(value: string | undefined) {
  return value?.trim().toLowerCase() === "false";
}

/** Redirect is an explicit emergency/test override, never the Postgres default. */
export function pilotEmailRedirectEnabled() {
  const configured = process.env.EMAIL_TEST_REDIRECT;
  if (isTrue(configured)) return true;
  if (isFalse(configured)) return false;
  return false;
}

export function pilotEmailRecipient(intendedRecipient: string) {
  const intended = intendedRecipient.trim().toLowerCase();
  const to = pilotEmailRedirectEnabled() ? PILOT_TEST_EMAIL : intended;
  const cc = PILOT_INTERNAL_EMAIL_COPIES.filter((address) => address !== to);
  return { to, cc, intendedTo: intended, redirected: to !== intended };
}

export function pilotVoiceDryRunEnabled() {
  const configured = process.env.PILOT_VOICE_DRY_RUN;
  if (isTrue(configured)) return true;
  if (isFalse(configured)) return false;
  // Missing configuration remains fail-closed for the Pilot.
  return process.env.RECRUITMENT_BACKEND?.trim().toLowerCase() === "postgres";
}
