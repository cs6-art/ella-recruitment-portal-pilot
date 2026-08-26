const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+|00)?\d[\d\s().-]{7,}\d/g;

const COUNTRY_CODES: Record<string, string> = {
  philippines: "PH",
  filipino: "PH",
  singapore: "SG",
  malay: "MY",
  malaysia: "MY",
};

function clean(value: unknown) {
  return String(value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizePhone(value: string, country = "") {
  const raw = clean(value);
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00") && digits.length > 10) return `+${digits.slice(2)}`;
  if (digits.startsWith("63") || digits.startsWith("65") || digits.startsWith("60")) return `+${digits}`;
  if (country === "PH" && digits.startsWith("0") && digits.length >= 10) return `+63${digits.slice(1)}`;
  if (country === "SG" && digits.length === 8) return `+65${digits}`;
  if (country === "MY" && digits.startsWith("0") && digits.length >= 9) return `+60${digits.slice(1)}`;
  return "";
}

function countryFromText(text: string) {
  const lower = text.toLowerCase();
  for (const [name, code] of Object.entries(COUNTRY_CODES)) {
    if (lower.includes(name)) return code;
  }
  return "";
}

function nameFromText(text: string, email: string, phone: string) {
  const lines = text.split(/\r?\n/).map((line) => clean(line)).filter(Boolean).slice(0, 35);
  const emailLower = email.toLowerCase();
  const phoneDigits = phone.replace(/\D/g, "");
  const labelled = lines.find((line) => /^(full\s+name|candidate\s+name|name)\s*:/i.test(line));
  const candidates = labelled ? [labelled.replace(/^(full\s+name|candidate\s+name|name)\s*:\s*/i, ""), ...lines] : lines;
  for (const line of candidates) {
    const normalized = line.replace(/[|•·]/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized || normalized.toLowerCase().includes(emailLower) || (phoneDigits && normalized.replace(/\D/g, "").includes(phoneDigits))) continue;
    if (/^(resume|curriculum vitae|cv|profile|contact|personal details|professional summary|objective|experience|education|skills|mobile|phone|email)\b/i.test(normalized)) continue;
    if (/https?:\/\/|www\.|@|\d{3,}/i.test(normalized)) continue;
    const words = normalized.split(/\s+/).filter((word) => /^[A-Za-z][A-Za-z'’-]*$/.test(word));
    if (words.length >= 2 && words.length <= 6) return words.join(" ");
  }
  return "";
}

/**
 * Extract the basic contact details that are explicitly visible in a resume.
 * This is deliberately deterministic and acts as a safety net for resumes
 * whose layout causes the AI extractor to return an incomplete response.
 */
export function extractResumeContactDetails(resumeText: string) {
  const text = clean(resumeText);
  const email = (text.match(EMAIL_PATTERN)?.[0] || "").toLowerCase();
  const country = countryFromText(text);
  const phone = (text.match(PHONE_PATTERN) || [])
    .map((candidate) => normalizePhone(candidate, country))
    .find(Boolean) || "";
  return {
    candidateName: nameFromText(text, email, phone),
    candidateEmail: email,
    preferredMobile: phone,
    applicantCountry: country,
  };
}

