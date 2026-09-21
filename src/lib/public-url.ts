import { getPortalConfigValue } from "@/lib/portal-config";

function normalizeConfiguredOrigin(value: string | undefined): string {
  const configured = value?.trim().replace(/\/$/, "");
  if (!configured) return "";
  try {
    const parsed = new URL(configured);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.origin;
  } catch {
    // Fall through to the caller's request-host handling.
  }
  return "";
}

export function requestOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim() || request.headers.get("host")?.trim();
  if (forwardedHost) {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() || "http";
    return `${forwardedProto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}

/**
 * Async resolver used by workflow routes: Settings `App_URL` (or its
 * `NEXT_PUBLIC_APP_URL` fallback) wins, otherwise the incoming request host.
 */
export async function resolvePublicAppBaseUrl(request: Request): Promise<string> {
  const configured = normalizeConfiguredOrigin(await getPortalConfigValue("App_URL"));
  return configured || requestOrigin(request);
}

export function getPublicAppBaseUrl(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.origin;
    } catch {
      // Fall through to the request host when configuration is malformed.
    }
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim() || request.headers.get("host")?.trim();
  if (forwardedHost) {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() || "http";
    return `${forwardedProto}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

export function bookingLink(baseUrl: string, kind: "voice" | "final", token: string) {
  return `${baseUrl.replace(/\/$/, "")}/book/${kind}/${encodeURIComponent(token)}`;
}

export function avatarInterviewLink(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/$/, "")}/avatar/${encodeURIComponent(token)}`;
}

/**
 * Build the public application URL for a role. Postgres role IDs are scoped
 * to an organization, so the organization context is part of the public
 * link whenever it is available.
 */
export function publicApplicationLink(baseUrl: string, roleId: string, organizationId = "") {
  const path = `/apply/${encodeURIComponent(roleId)}`;
  const organization = organizationId.trim();
  const suffix = organization ? `?organizationId=${encodeURIComponent(organization)}` : "";
  return `${baseUrl.replace(/\/$/, "")}${path}${suffix}`;
}

/**
 * Preserve an existing stored application URL while adding or correcting its
 * tenant query parameter. This also upgrades links saved before tenant-local
 * role IDs were introduced.
 */
export function applicationLinkWithOrganization(link: string, roleId: string, organizationId = "") {
  const fallback = publicApplicationLink("", roleId, organizationId);
  const cleanLink = link.trim() || fallback;
  const organization = organizationId.trim();
  if (!organization) return cleanLink;

  try {
    const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(cleanLink);
    const parsed = new URL(cleanLink, "https://mclink.invalid");
    parsed.searchParams.set("organizationId", organization);
    const value = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return absolute ? `${parsed.origin}${value}` : value;
  } catch {
    const separator = cleanLink.includes("?") ? "&" : "?";
    return `${cleanLink}${separator}organizationId=${encodeURIComponent(organization)}`;
  }
}
