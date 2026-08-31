import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canManagePipeline } from "@/lib/access-control";
import { getMicrosoftConsentUrl } from "@/lib/microsoft-drive";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export async function GET(request: Request) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.redirect(new URL("/", request.url));
  if (!canManagePipeline(user)) return NextResponse.json({ success: false, error: "Only HR reviewers can connect OneDrive." }, { status: 403 });

  const rate = consumeRateLimit(`onedrive-connect:${user.email}:${requestClientKey(request)}`, 10, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many OneDrive connection attempts. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  try {
    const url = getMicrosoftConsentUrl(user.email, new URL(request.url).origin);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("[OneDrive] Failed to build consent URL:", error);
    return NextResponse.json({ success: false, error: "OneDrive connection is not configured yet." }, { status: 500 });
  }
}
