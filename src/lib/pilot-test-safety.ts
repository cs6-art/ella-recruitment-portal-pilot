/**
 * Pilot-only outbound safety boundaries.
 *
 * The Postgres recruitment target is used only by the Pilot deployment during
 * this validation phase. Its email and voice integrations must therefore be
 * safe by construction: test mail is redirected to the QA mailbox and voice
 * dispatch requires an explicit dry-run flag.
 */
export const PILOT_TEST_EMAIL = "cs6@mclinkgroup.com";

export function pilotEmailRecipient(intendedRecipient: string) {
  const intended = intendedRecipient.trim().toLowerCase();
  const targetMode = process.env.RECRUITMENT_BACKEND?.trim().toLowerCase() === "postgres";
  return targetMode
    ? { to: PILOT_TEST_EMAIL, intendedTo: intended, redirected: intended !== PILOT_TEST_EMAIL }
    : { to: intended, intendedTo: intended, redirected: false };
}

export function pilotVoiceDryRunEnabled() {
  // Postgres target mode is Pilot-only during this validation phase. Keep the
  // voice boundary fail-safe even if a deployment misses the optional flag;
  // an explicit true flag remains useful for local tests outside target mode.
  return process.env.RECRUITMENT_BACKEND?.trim().toLowerCase() === "postgres"
    || process.env.PILOT_VOICE_DRY_RUN?.trim().toLowerCase() === "true";
}
