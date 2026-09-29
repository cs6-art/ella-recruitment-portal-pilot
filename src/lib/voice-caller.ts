/**
 * Which of our Vapi phone numbers a call is placed from. Candidates in the
 * Philippines and Malaysia are called from a number of their own country, which
 * they are more likely to answer; everyone else is called from the Singapore
 * number. The region follows the number being dialled, not the country stored
 * on the applicant, which may be missing or out of date.
 */
export type CallerRegion = "PH" | "MY" | "SG";

export function callerRegionFor(e164Number: string): CallerRegion {
  const number = e164Number.trim();
  if (number.startsWith("+63")) return "PH";
  if (number.startsWith("+60")) return "MY";
  return "SG";
}

export function callerPhoneNumberId(region: CallerRegion, env: Record<string, string | undefined> = process.env): string {
  const specific = env[`VAPI_PHONE_NUMBER_ID_${region}`]?.trim();
  if (specific) return specific;
  // Until a country number is configured, fall back to the Singapore number
  // (the single number the pilot has always used) rather than failing the call.
  return env.VAPI_PHONE_NUMBER_ID_SG?.trim() || env.PILOT_VAPI_PHONE_NUMBER_ID?.trim() || "";
}

export function callerFor(e164Number: string, env: Record<string, string | undefined> = process.env) {
  const region = callerRegionFor(e164Number);
  const phoneNumberId = callerPhoneNumberId(region, env);
  return { region, phoneNumberId, usedFallback: region !== "SG" && !env[`VAPI_PHONE_NUMBER_ID_${region}`]?.trim() };
}
