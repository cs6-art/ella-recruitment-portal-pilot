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

function requestOrigin(request: Request): string {
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
