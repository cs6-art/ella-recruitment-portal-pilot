import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canManagePipeline } from "@/lib/access-control";
import { disconnectDrive } from "@/lib/google-drive";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export async function POST(request: Request) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (!canManagePipeline(user)) return NextResponse.json({ success: false, error: "Only HR reviewers can manage Google Drive." }, { status: 403 });

  const rate = consumeRateLimit(`drive-disconnect:${user.email}:${requestClientKey(request)}`, 20, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many requests. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  try {
    await disconnectDrive(user.email);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Google Drive] Disconnect failed:", error);
    return NextResponse.json({ success: false, error: "Unable to disconnect Google Drive." }, { status: 500 });
  }
}
