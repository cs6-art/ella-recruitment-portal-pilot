const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+|00)?\d[\d\s().-]{7,}\d/g;

const COUNTRY_CODES: Record<string, string> = {
  philippines: "PH",
  filipino: "PH",
  singapore: "SG",
  malay: "MY",
  malaysia: "MY",
};

// Words that never belong in a person's name. A line containing any of them is
// a section heading, job title, or company line ("PROFESSIONAL EXPERIENCE",
// "DATA CENTER OPERATIONS ASIA"), not the candidate heading.
const NON_NAME_WORDS = new Set([
  "about", "achievements", "activities", "address", "affiliations", "analyst", "and", "application", "asia", "assistant",
  "associate", "awards", "background", "career", "center", "centre", "certifications", "certificates", "college", "company",
  "consultant", "contact", "coordinator", "corporation", "curriculum", "cv", "data", "details", "developer", "director", "education",
  "email", "employment", "engineer", "engineering", "executive", "experience", "for", "highlights", "history", "in", "inc", "information",
  "interests", "intern", "languages", "ltd", "manager", "mobile", "of", "objective", "officer", "operations", "overview", "personal",
  "phone", "portfolio", "professional", "profile", "projects", "qualifications", "references", "resume", "school", "services",
  "skills", "solutions", "specialist", "summary", "supervisor", "technical", "technician", "the", "trainings", "university",
  "vitae", "with", "work",
]);

// Location words that PDF extraction often glues onto the end of the name line
// ("VALERIE L Philippines"). They are stripped from the end, never the start.
const TRAILING_LOCATION_WORDS = new Set([
  "philippines", "singapore", "malaysia", "manila", "metro", "cebu", "davao", "quezon", "city", "makati", "taguig", "pasig",
  "laguna", "cavite", "batangas", "pampanga", "rizal", "bulacan", "kuala", "lumpur", "selangor", "johor", "penang", "ph", "sg", "my",
]);

function clean(value: unknown) {
  return String(value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

function cleanResumeText(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r?\n\s*/g, "\n")
    .trim();
}

/** Lowercase, accent-free, letters only — for comparing names across sources. */
function letters(value: string) {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
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

/** "ALLEN PESIGAN" → "Allen Pesigan"; mixed-case words ("McDonald") are kept. */
function formatName(words: string[]) {
  return words.map((word) => {
    if (word !== word.toUpperCase() && word !== word.toLowerCase()) return word;
    return word.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`);
  }).join(" ");
}

/** Rejoin letter-spaced headings ("V A L E R I E") split from other text by wide gaps. */
function joinSpacedLetters(segment: string) {
  return /^(?:\p{L} ){2,}\p{L}$/u.test(segment) ? segment.replace(/ /g, "") : segment;
}

function nameWords(line: string) {
  const segments = line.replace(/\t/g, "  ").split(/ {2,}|[|•·]/).map((segment) => joinSpacedLetters(clean(segment))).filter(Boolean);
  const normalized = segments.join(" ").replace(/,.*$/, "").trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length || !words.every((word) => /^\p{L}[\p{L}'’.-]*$/u.test(word))) return [];
  if (words.some((word) => NON_NAME_WORDS.has(word.toLowerCase().replace(/[.'’]/g, "")))) return [];
  while (words.length > 2 && TRAILING_LOCATION_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();
  if (words.length < 2 || words.length > 5) return [];
  if (words.filter((word) => letters(word).length >= 2).length < 2) return [];
  return words;
}

function nameFromText(rawText: string, email: string, phone: string, fileName: string) {
  const rawLines = String(rawText ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").split(/\r?\n/)
    .filter((line) => line.trim()).slice(0, 35);
  const emailLower = email.toLowerCase();
  const emailLocal = letters(emailLower.split("@")[0] || "");
  const phoneDigits = phone.replace(/\D/g, "");
  const fileLetters = letters(fileName.replace(/\.[^.]+$/, "").replace(/\b(resume|cv|curriculum vitae)\b/gi, " "));

  let best: { words: string[]; score: number } | null = null;
  rawLines.forEach((rawLine, index) => {
    let line = rawLine;
    let score = 10 - index * 0.25;
    const labelled = /^\s*(full\s+name|candidate\s+name|name)\s*:\s*/i;
    if (labelled.test(line)) {
      line = line.replace(labelled, "");
      score += 20;
    }
    const flat = clean(line);
    if (!flat || (emailLower && flat.toLowerCase().includes(emailLower)) || (phoneDigits && flat.replace(/\D/g, "").includes(phoneDigits))) return;
    if (/https?:\/\/|www\.|@|\d/i.test(flat)) return;
    const words = nameWords(line);
    if (!words.length) return;
    // A name that also appears in the email address or filename is far more
    // likely to be the candidate than a heading that happened to pass the
    // filters, so those agreements outweigh line position.
    for (const word of words) {
      const token = letters(word);
      if (token.length < 3) continue;
      if (emailLocal.includes(token)) score += 6;
      if (fileLetters.includes(token)) score += 4;
    }
    if (!best || score > best.score) best = { words, score };
  });
  if (best) return formatName((best as { words: string[] }).words);

  // Last resort: "allen.pesigan@…" → "Allen Pesigan".
  const parts = (emailLower.split("@")[0] || "").split(/[._]/).filter((part) => /^[a-z]{2,}$/.test(part));
  return parts.length >= 2 && parts.length <= 4 && !parts.some((part) => NON_NAME_WORDS.has(part)) ? formatName(parts) : "";
}

/**
 * Accept an AI-extracted candidate name only when it is grounded in the
 * resume: every name token (ignoring initials) must appear in the resume text
 * or email address. Tokens of 5+ letters may differ by one dropped letter, the
 * usual PDF ligature loss ("VAL RIE" for "VALERIE"). Returns "" when the name
 * cannot be verified, so a hallucinated name never replaces the original.
 */
export function verifiedResumeName(candidate: unknown, resumeText: string, email = "") {
  const name = clean(candidate).replace(/\s*,\s*/g, " ");
  if (!name || name.length > 120 || /[\d@]|https?:/i.test(name)) return "";
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6 || !words.every((word) => /^\p{L}[\p{L}'’.-]*$/u.test(word))) return "";
  const tokens = words.map(letters).filter((token) => token.length >= 2);
  if (tokens.length < 2) return "";
  const haystack = letters(resumeText);
  const emailLocal = letters(email.split("@")[0] || "");
  const grounded = (token: string) => {
    if (haystack.includes(token) || emailLocal.includes(token)) return true;
    if (token.length < 5) return false;
    for (let i = 0; i < token.length; i += 1) {
      if (haystack.includes(token.slice(0, i) + token.slice(i + 1))) return true;
    }
    return false;
  };
  return tokens.every(grounded) ? formatName(words) : "";
}

/**
 * Extract the basic contact details that are explicitly visible in a resume.
 * This is deliberately deterministic and acts as a safety net for resumes
 * whose layout causes the AI extractor to return an incomplete response. The
 * AI screener can later replace the name via verifiedResumeName.
 */
export function extractResumeContactDetails(resumeText: string, options: { fileName?: string } = {}) {
  // Keep line boundaries for name detection. Flattening the entire resume to
  // one line makes the first email/phone match swallow the candidate heading,
  // which is why older bulk rows fell back to the raw filename.
  const text = cleanResumeText(resumeText);
  const email = (text.match(EMAIL_PATTERN)?.[0] || "").toLowerCase();
  const country = countryFromText(text);
  const phone = (text.match(PHONE_PATTERN) || [])
    .map((candidate) => normalizePhone(candidate, country))
    .find(Boolean) || "";
  return {
    candidateName: nameFromText(resumeText, email, phone, options.fileName || ""),
    candidateEmail: email,
    preferredMobile: phone,
    applicantCountry: country,
  };
}
