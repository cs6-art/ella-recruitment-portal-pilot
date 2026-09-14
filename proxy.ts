import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The candidate page contains a form, so direct visits without an invitation
// must not receive the static page. The invitation itself is still validated
// by the page and by the submission API.
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/index.html" && !request.nextUrl.searchParams.get("invite")?.trim()) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Browser mutations carry an Origin header. Reject cross-site requests
  // before they reach a session-authenticated route. Public candidate intake
  // is intentionally cross-origin because legacy invite pages can be hosted
  // on a separate static domain; that route performs its own invite, CORS,
  // and rate-limit checks. Server-to-server integrations use their own
  // internal/webhook/cron authentication and are exempt from this browser
  // check.
  if (isBrowserMutation(request)) {
    const path = request.nextUrl.pathname;
    const integrationRoute = path.startsWith("/api/public/")
      || path.startsWith("/api/internal/")
      || path.startsWith("/api/webhooks/")
      || path.startsWith("/api/cron/");
    if (!integrationRoute && !sameOrigin(request)) {
      return NextResponse.json({ success: false, error: "Cross-site request blocked." }, { status: 403 });
    }
  }

  return NextResponse.next();
}

function isBrowserMutation(request: NextRequest) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)
    && request.nextUrl.pathname.startsWith("/api/");
}

function sameOrigin(request: NextRequest) {
  const suppliedOrigin = request.headers.get("origin")?.trim()
    || (() => {
      const referer = request.headers.get("referer")?.trim();
      if (!referer) return "";
      try {
        return new URL(referer).origin;
      } catch {
        return "";
      }
    })();
  if (!suppliedOrigin) return false;

  let parsed: URL;
  try {
    parsed = new URL(suppliedOrigin);
  } catch {
    return false;
  }

  const allowed = new Set<string>([request.nextUrl.origin]);
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (configured) {
    try {
      allowed.add(new URL(configured).origin);
    } catch {
      // Ignore malformed optional configuration; the request origin remains
      // the only safe fallback.
    }
  }
  if (process.env.VERCEL_URL?.trim()) allowed.add(`https://${process.env.VERCEL_URL.trim()}`);
  return allowed.has(parsed.origin);
}

export const config = {
  matcher: ["/index.html", "/api/:path*"],
};
