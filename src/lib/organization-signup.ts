/**
 * Rules for self-service organization sign-up: the first person to register
 * with a company email domain that no organization owns creates a new
 * organization for it. Kept free of database imports so it can be unit tested.
 */

type OrganizationRule = { allowedDomains: string[]; allowedEmails: string[] };

/** The platform's own organization name cannot be claimed by self-service sign-up. */
export const RESERVED_ORGANIZATION_SLUGS: ReadonlySet<string> = new Set(["mclinkgroup"]);

/** Free or personal mailbox providers. They cannot create an organization, since anyone could sign up with them. */
export const PERSONAL_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.com.ph", "yahoo.com.sg", "yahoo.co.uk", "yahoo.co.jp", "ymail.com", "rocketmail.com",
  "outlook.com", "outlook.ph", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net", "mail.com", "zoho.com", "yandex.com", "yandex.ru",
  "qq.com", "163.com", "126.com", "naver.com", "daum.net", "fastmail.com", "hey.com", "tutanota.com", "tuta.io",
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "yopmail.com", "trashmail.com",
]);

// Second-level suffixes where the company name is the label before them (acme.com.ph -> acme).
const MULTI_PART_SUFFIXES = ["com.ph", "com.sg", "com.my", "com.au", "com.hk", "co.uk", "co.nz", "co.jp", "co.id", "co.th", "org.ph", "org.uk", "net.ph"];

export function emailDomain(email: string) {
  return (email.trim().toLowerCase().split("@")[1] || "").replace(/^@/, "");
}

export function isPersonalEmailDomain(domain: string) {
  return PERSONAL_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/** True when any organization (active or not) already lists this domain, or an address on it. */
export function isDomainClaimed(domain: string, rules: OrganizationRule[]) {
  const wanted = domain.trim().toLowerCase().replace(/^@/, "");
  return rules.some((rule) =>
    rule.allowedDomains.some((value) => value.trim().toLowerCase().replace(/^@/, "") === wanted)
    || rule.allowedEmails.some((value) => emailDomain(value) === wanted));
}

function companyLabel(domain: string) {
  const lower = domain.trim().toLowerCase().replace(/^@/, "");
  const suffix = MULTI_PART_SUFFIXES.find((value) => lower.endsWith(`.${value}`));
  const labels = (suffix ? lower.slice(0, -(suffix.length + 1)) : lower.replace(/\.[^.]+$/, "")).split(".").filter(Boolean);
  return labels[labels.length - 1] || "organization";
}

export function organizationNameFromDomain(domain: string) {
  const words = companyLabel(domain).split(/[-_]+/).filter(Boolean);
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  return name.length >= 2 ? name : "My Organization";
}

/** A public URL-safe name for the organization; callers add a numeric suffix when it is taken. */
export function organizationSlugFromDomain(domain: string) {
  const slug = companyLabel(domain).replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(slug) ? slug : "organization";
}

export function isReservedOrganizationDomain(domain: string) {
  return RESERVED_ORGANIZATION_SLUGS.has(organizationSlugFromDomain(domain));
}

/** People a self-service organization may have until a McLink administrator changes it. */
export const SELF_SERVICE_MEMBER_LIMIT = 5;

/** True when one more person would exceed the limit. A null or missing limit means no limit. */
export function isMemberLimitReached(limit: number | null | undefined, used: number) {
  return typeof limit === "number" && limit >= 1 && used >= limit;
}

/** Count seats used by active people and waiting invitations, without double-counting the person being checked. */
export function memberSeatUsage(input: { activeEmails: string[]; invitedEmails: string[]; pendingEmails: string[]; currentEmail?: string }) {
  const current = input.currentEmail?.trim().toLowerCase() || "";
  const active = new Set(input.activeEmails.map((email) => email.trim().toLowerCase()).filter(Boolean));
  active.delete(current);
  const waiting = new Set([...input.invitedEmails, ...input.pendingEmails].map((email) => email.trim().toLowerCase()).filter(Boolean));
  for (const email of active) waiting.delete(email);
  waiting.delete(current);
  return active.size + waiting.size;
}
