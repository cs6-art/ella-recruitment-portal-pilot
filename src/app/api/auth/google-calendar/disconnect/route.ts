import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { deleteCalendarConnection } from "@/lib/calendar-tokens";
import { getFinalInterviewCalendarConfig } from "@/lib/google-sheets";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export async function POST(request: Request) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  const self = new URL(request.url).searchParams.get("self") === "1";
  if (self) {
    if (user.canReviewRole !== true) return NextResponse.json({ success: false, error: "Only HR reviewers can disconnect a personal calendar." }, { status: 403 });
  } else if (user.canEditSettings !== true) return NextResponse.json({ success: false, error: "Only settings administrators can disconnect the shared HR calendar." }, { status: 403 });
  const rate = consumeRateLimit(`calendar-disconnect:${user.email}:${requestClientKey(request)}`, 10, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many calendar disconnect attempts. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  try {
    const calendarConfig = self ? { email: user.email.trim().toLowerCase() } : await getFinalInterviewCalendarConfig();
    await deleteCalendarConnection(calendarConfig.email);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Google Calendar] Disconnect failed:", error);
    return NextResponse.json({ success: false, error: "Unable to disconnect calendar." }, { status: 500 });
  }
}
