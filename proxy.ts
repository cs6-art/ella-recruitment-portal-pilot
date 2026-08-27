import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The candidate page contains a form, so direct visits without an invitation
// must not receive the static page. The invitation itself is still validated
// by the page and by the submission API.
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/index.html" && !request.nextUrl.searchParams.get("invite")?.trim()) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/index.html"],
};
