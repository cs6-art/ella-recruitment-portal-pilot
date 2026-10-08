/**
 * Who users contact for portal help, shown in Smile Bot's "Help"
 * tab. HRSG is the helpdesk for now; change it with `SUPPORT_EMAIL` and
 * `SUPPORT_NAME` (server-side env) without a code change.
 *
 * Kept free of imports so it can be unit tested directly.
 */

export const DEFAULT_SUPPORT_EMAIL = "hrsg@mclinkgroup.com";
export const DEFAULT_SUPPORT_NAME = "HRSG";

export type SupportContact = { email: string; name: string };

const EMAIL_PATTERN = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export function supportContact(env: Record<string, string | undefined> = process.env): SupportContact {
  const email = String(env.SUPPORT_EMAIL ?? "").trim().toLowerCase();
  const name = String(env.SUPPORT_NAME ?? "").trim().slice(0, 60);
  return {
    email: EMAIL_PATTERN.test(email) ? email : DEFAULT_SUPPORT_EMAIL,
    name: name || DEFAULT_SUPPORT_NAME,
  };
}
