import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getRecordingDriveConsentUrl } from "@/lib/recording-drive-oauth";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export async function GET(request: Request) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.redirect(new URL("/", request.url));
  if (user.canEditSettings !== true) return NextResponse.json({ success: false, error: "Settings permission required." }, { status: 403 });

  const rate = consumeRateLimit(`recording-drive-connect:${user.organizationId}:${user.email}:${requestClientKey(request)}`, 10, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many Google Drive connection attempts. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  try {
    const consentUrl = getRecordingDriveConsentUrl(user.organizationId, user.email, new URL(request.url).origin);
    return NextResponse.redirect(consentUrl);
  } catch (error) {
    console.error("[Recording Drive OAuth] Could not start authorization:", error);
    return NextResponse.redirect(new URL("/settings?recording-drive=error&recording-drive-reason=Google+Drive+connection+is+not+configured+yet.", request.url));
  }
}
