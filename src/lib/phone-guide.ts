import { getExampleNumber, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";
import examples from "libphonenumber-js/examples.mobile.json";

/**
 * Per-country guidance and checks for the "local mobile number" boxes. The
 * examples and length rules come from Google's libphonenumber data, so every
 * country in the list gets a real example, not just PH, SG and MY.
 *
 * The portal stores a number as the option's calling code plus a local part.
 * For territories that share a code (for example American Samoa, +1684) the
 * area digits belong to the calling code, so the local part is what follows them.
 */
export type PhoneCountry = { country: string; code: string; label: string };

function asCountryCode(country: string): CountryCode | undefined {
  return /^[A-Z]{2}$/.test(country) ? (country as CountryCode) : undefined;
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function example(country: PhoneCountry) {
  const iso = asCountryCode(country.country);
  if (!iso) return null;
  try {
    return getExampleNumber(iso, examples) || null;
  } catch {
    return null;
  }
}

/** Digits of the option's calling code that libphonenumber counts as part of the number (e.g. "684"). */
function areaDigits(country: PhoneCountry, callingCode: string) {
  return country.code.startsWith(`+${callingCode}`) ? country.code.slice(1 + callingCode.length) : "";
}

/** A sample local mobile number as people write it, without the country code or trunk zero. */
export function phoneExample(country: PhoneCountry): string {
  const sample = example(country);
  if (!sample) return "";
  const area = areaDigits(country, sample.countryCallingCode);
  if (area) return sample.nationalNumber.startsWith(area) ? sample.nationalNumber.slice(area.length) : "";
  return sample.formatInternational().replace(new RegExp(`^\\+${sample.countryCallingCode}\\s*`), "").trim();
}

/** The digit(s) people in that country add in front locally (usually 0), which must be left out. */
function trunkPrefix(country: PhoneCountry): string {
  const sample = example(country);
  if (!sample) return "";
  const national = digitsOnly(sample.formatNational());
  return national.length > sample.nationalNumber.length && national.endsWith(sample.nationalNumber) ? national.slice(0, national.length - sample.nationalNumber.length) : "";
}

/** Placeholder text for the number box. */
export function phonePlaceholder(country: PhoneCountry): string {
  return phoneExample(country) || "Local mobile number";
}

/** The helper line under the number box. */
export function phoneGuide(country: PhoneCountry): string {
  const sample = phoneExample(country);
  const trunk = trunkPrefix(country);
  const base = `Enter the ${country.label} mobile number without the country code ${country.code}`;
  const skip = trunk ? ` and without the leading ${trunk}` : "";
  return sample ? `${base}${skip}. Example: ${sample}.` : `${base}${skip}.`;
}

/**
 * The digits to append to the country code. Drops a leading trunk zero
 * (0917… becomes 917…) and a country code the person typed anyway.
 */
export function normalizeLocalNumber(country: PhoneCountry, input: string): string {
  const digits = digitsOnly(input);
  if (!digits) return "";
  const iso = asCountryCode(country.country);
  const parsed = iso ? parsePhoneNumberFromString(digits, iso) : undefined;
  if (parsed?.nationalNumber && country.code.startsWith(`+${parsed.countryCallingCode}`)) {
    const national = String(parsed.nationalNumber);
    const area = areaDigits(country, parsed.countryCallingCode);
    return area && national.startsWith(area) ? national.slice(area.length) : national;
  }
  return digits;
}

// The countries the portal calls most are held to a strict mobile pattern (no
// landlines). Everywhere else a number of the right length for that country is
// accepted, so a newly issued mobile range is never turned away.
const STRICT_MOBILE: Record<string, RegExp> = {
  PH: /^9\d{9}$/,
  SG: /^[89]\d{7}$/,
  MY: /^1\d{8,9}$/,
};

/** An error message when the number cannot be right for the country, otherwise an empty string. */
export function phoneProblem(country: PhoneCountry, input: string): string {
  const local = normalizeLocalNumber(country, input);
  if (!local) return "Enter your contact number.";
  const sample = phoneExample(country);
  const hint = `Enter a valid ${country.label} mobile number${sample ? `, for example ${sample}` : ""}.`;
  const strict = STRICT_MOBILE[country.country];
  if (strict) return strict.test(local) ? "" : hint;
  const full = `${country.code}${local}`;
  const parsed = parsePhoneNumberFromString(full);
  if (!parsed) return /^\+[1-9]\d{7,14}$/.test(full) ? "" : hint;
  return parsed.isPossible() ? "" : hint;
}

/** The international number to store and dial, or an empty string if the input is not a plausible number. */
export function internationalNumber(country: PhoneCountry, input: string): string {
  const local = normalizeLocalNumber(country, input);
  return local ? `${country.code}${local}` : "";
}
