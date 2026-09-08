/**
 * Pilot-only outbound safety boundaries.
 *
 * The Postgres recruitment target is used only by the Pilot deployment during
 * this validation phase. Its email and voice integrations must therefore be
 * safe by construction: test mail is redirected to the QA mailbox and voice
 * dispatch remains dry-run unless the Pilot explicitly opts into live mode.
 */
export const PILOT_TEST_EMAIL = "cs6@mclinkgroup.com";

function isTrue(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function isFalse(value: string | undefined) {
  return value?.trim().toLowerCase() === "false";
}

/** Candidate mail is redirected by default until the Pilot explicitly opts in. */
export function pilotEmailRedirectEnabled() {
  const configured = process.env.EMAIL_TEST_REDIRECT;
  if (isTrue(configured)) return true;
  if (isFalse(configured)) return false;
  return process.env.RECRUITMENT_BACKEND?.trim().toLowerCase() === "postgres";
}

export function pilotEmailRecipient(intendedRecipient: string) {
  const intended = intendedRecipient.trim().toLowerCase();
  return pilotEmailRedirectEnabled()
    ? { to: PILOT_TEST_EMAIL, intendedTo: intended, redirected: intended !== PILOT_TEST_EMAIL }
    : { to: intended, intendedTo: intended, redirected: false };
}

export function pilotVoiceDryRunEnabled() {
  const configured = process.env.PILOT_VOICE_DRY_RUN;
  if (isTrue(configured)) return true;
  if (isFalse(configured)) return false;
  // Missing configuration remains fail-closed for the Pilot.
  return process.env.RECRUITMENT_BACKEND?.trim().toLowerCase() === "postgres";
}
