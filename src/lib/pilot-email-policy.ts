/**
 * Pilot outbound-email safety switch.
 *
 * The Postgres-backed portal uses the target n8n notification workflow. Keep
 * that path fail-closed when the explicit pilot flag is absent, while still
 * allowing the reviewed deployment setting to enable delivery.
 */
export function pilotOutboundEmailEnabled() {
  const backend = process.env.RECRUITMENT_BACKEND?.trim().toLowerCase();
  const configured = process.env.PILOT_OUTBOUND_EMAIL_ENABLED?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;

  return backend !== "postgres";
}

export const PILOT_OUTBOUND_EMAIL_DISABLED_MESSAGE =
  "Pilot outbound email notifications are disabled.";
