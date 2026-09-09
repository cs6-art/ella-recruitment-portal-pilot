/**
 * Resolve the IANA timezone to show a candidate on their booking link.
 *
 * The AI voice interview is a phone call placed to the candidate, so its slot
 * times are shown in the candidate's own country timezone. Face-to-face
 * interview times stay in the office/role timezone and must not use this.
 */
export const DEFAULT_INTERVIEW_TIMEZONE = "Asia/Singapore";

// Applications are currently accepted from PH / SG / MY (see CountryOptions),
// but keep a wider map so a manually entered country still resolves sensibly.
const COUNTRY_TIMEZONES: Record<string, string> = {
  PH: "Asia/Manila",
  SG: "Asia/Singapore",
  MY: "Asia/Kuala_Lumpur",
  ID: "Asia/Jakarta",
  TH: "Asia/Bangkok",
  VN: "Asia/Ho_Chi_Minh",
  IN: "Asia/Kolkata",
  HK: "Asia/Hong_Kong",
  CN: "Asia/Shanghai",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
  AU: "Australia/Sydney",
  GB: "Europe/London",
  US: "America/New_York",
};

const DIALLING_CODE_COUNTRIES: Array<[string, string]> = [
  ["63", "PH"],
  ["65", "SG"],
  ["60", "MY"],
  ["62", "ID"],
  ["66", "TH"],
  ["84", "VN"],
  ["91", "IN"],
  ["852", "HK"],
  ["86", "CN"],
  ["81", "JP"],
  ["82", "KR"],
  ["61", "AU"],
  ["44", "GB"],
  ["1", "US"],
];

function isValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/** ISO 3166-1 alpha-2 code from a stored country value or an E.164 phone number. */
export function applicantCountryCode(country?: string | null, phone?: string | null): string {
  const raw = String(country ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  const digits = String(phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  for (const [code, iso] of DIALLING_CODE_COUNTRIES) {
    if (digits.startsWith(code)) return iso;
  }
  return "";
}

/**
 * Timezone to show the candidate for the AI voice interview. Falls back to the
 * role/default timezone when the country is unknown or unmapped.
 */
export function applicantVoiceTimezone(
  input: { country?: string | null; phone?: string | null },
  fallback = DEFAULT_INTERVIEW_TIMEZONE,
): string {
  const safeFallback = isValidTimezone(fallback) ? fallback : DEFAULT_INTERVIEW_TIMEZONE;
  const zone = COUNTRY_TIMEZONES[applicantCountryCode(input.country, input.phone)];
  return zone && isValidTimezone(zone) ? zone : safeFallback;
}
