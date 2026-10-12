/**
 * Sample (demo) candidates must never reach a real person.
 *
 * An applicant created from a built-in sample resume is stored with
 * `source_detail = "sample_resume:<id>"` and a reserved example.com address.
 * Every outbound boundary (interview invitations and booking links, automatic
 * approval, the email notification queue) checks `isSampleApplication`, so
 * hiding a button is never the only protection.
 *
 * Dependency-free: imported by server code, client badges and tests.
 */

export const SAMPLE_SOURCE_PREFIX = "sample_resume:";

/** Shown wherever an outbound action is refused for a sample candidate. */
export const SAMPLE_CANDIDATE_BLOCKED_MESSAGE =
  "This is a sample candidate created from a built-in demo resume. Smile never sends emails, interview invitations, calls or calendar invites to sample candidates.";

// RFC 2606 / RFC 6761 reserved names: mail to these can never be delivered.
const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org"]);
const RESERVED_SUFFIXES = [".example", ".test", ".invalid", ".localhost"];

export function sampleSourceDetail(sampleResumeId: string): string {
  return `${SAMPLE_SOURCE_PREFIX}${sampleResumeId}`;
}

/** The sample resume id recorded on an application, or "" for a real applicant. */
export function sampleResumeIdFromSource(sourceDetail: string | null | undefined): string {
  const value = String(sourceDetail ?? "").trim();
  return value.startsWith(SAMPLE_SOURCE_PREFIX) ? value.slice(SAMPLE_SOURCE_PREFIX.length) : "";
}

export function isReservedDemoEmail(email: string | null | undefined): boolean {
  const domain = String(email ?? "").trim().toLowerCase().split("@")[1] || "";
  if (!domain) return false;
  return RESERVED_DOMAINS.has(domain) || [...RESERVED_DOMAINS].some((reserved) => domain.endsWith(`.${reserved}`)) || RESERVED_SUFFIXES.some((suffix) => domain.endsWith(suffix));
}

/** Australia's 0491 57x xxx range is reserved for fiction; every sample candidate uses it. */
export function isReservedDemoPhone(phone: string | null | undefined): boolean {
  return /^\+6149157\d{4}$/.test(String(phone ?? "").replace(/[\s()-]/g, ""));
}

/** True for applicants created from a sample resume, or whose address can never receive mail. */
export function isSampleApplication(application: { sourceDetail?: string | null; email?: string | null } | null | undefined): boolean {
  if (!application) return false;
  return Boolean(sampleResumeIdFromSource(application.sourceDetail)) || isReservedDemoEmail(application.email);
}
