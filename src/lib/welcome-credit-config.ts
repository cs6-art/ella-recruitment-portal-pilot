/**
 * One-time free Smile Credits for a newly created organization, so a client can
 * try the portal before buying a pack. 30 credits covers about 30 CV analyses,
 * or 1 phone interview plus 20 CV analyses. Override with
 * `ELLA_WELCOME_CREDITS` (a whole number; `0` turns the grant off).
 */
export const DEFAULT_WELCOME_CREDITS = 30;

export function welcomeCredits(raw: string | undefined = process.env.ELLA_WELCOME_CREDITS): number {
  const text = raw?.trim();
  if (!text) return DEFAULT_WELCOME_CREDITS;
  const value = Number(text);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_WELCOME_CREDITS;
}
