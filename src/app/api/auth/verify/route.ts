import { NextResponse } from "next/server";

import { getPublicAppBaseUrl } from "@/lib/public-url";
import { consumeRateLimit, requestClientKey } from "@/lib/rate-limit";
import { verifyRegistration } from "@/lib/registration";

/** Target of the emailed link. It only marks the email verified; the user then logs in. */
export async function GET(request: Request) {
  const base = getPublicAppBaseUrl(request);
  const rate = consumeRateLimit(`verify:${requestClientKey(request)}`, 20, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.redirect(`${base}/?verify=invalid`, 303);

  try {
    const token = new URL(request.url).searchParams.get("token") || "";
    const result = await verifyRegistration(token);
    return NextResponse.redirect(`${base}/?verify=${result.status}`, 303);
  } catch (error) {
    console.error("[Verify] Failed:", error instanceof Error ? error.message : error);
    return NextResponse.redirect(`${base}/?verify=error`, 303);
  }
}
