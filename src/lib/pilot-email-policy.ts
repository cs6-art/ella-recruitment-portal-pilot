/**
 * Pilot outbound-email safety switch.
 *
 * The Postgres-backed portal currently uses pilot n8n workflows. Keep email
 * delivery disabled for that target so a stale or newly-created queue row
 * cannot send another `[PILOT]` message. This is intentionally hard-disabled
 * for the Postgres target until those workflows are retired; an environment
 * override must not be able to re-enable the messages.
 */
export function pilotOutboundEmailEnabled() {
  const backend = process.env.RECRUITMENT_BACKEND?.trim().toLowerCase();
  if (backend === "postgres") return false;

  const configured = process.env.PILOT_OUTBOUND_EMAIL_ENABLED?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;

  return true;
}

export const PILOT_OUTBOUND_EMAIL_DISABLED_MESSAGE =
  "Pilot outbound email notifications are disabled.";
