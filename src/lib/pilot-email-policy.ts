/**
 * Pilot outbound-email safety switch.
 *
 * The Postgres-backed portal currently uses pilot n8n workflows. Keep email
 * delivery disabled by default for that target so a stale or newly-created
 * queue row cannot send another `[PILOT]` message. Re-enable deliberately by
 * setting PILOT_OUTBOUND_EMAIL_ENABLED=true after the pilot mail workflows
 * are ready for production use.
 */
export function pilotOutboundEmailEnabled() {
  const configured = process.env.PILOT_OUTBOUND_EMAIL_ENABLED?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;

  return process.env.RECRUITMENT_BACKEND?.trim().toLowerCase() !== "postgres";
}

export const PILOT_OUTBOUND_EMAIL_DISABLED_MESSAGE =
  "Pilot outbound email notifications are disabled.";
