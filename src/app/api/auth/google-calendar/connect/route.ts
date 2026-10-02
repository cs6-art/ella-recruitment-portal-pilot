import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getGoogleConsentUrl } from "@/lib/google-calendar";
import { defaultPortalSettings, getFinalInterviewCalendarConfig, upsertPortalSettings } from "@/lib/google-sheets";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export async function GET(request: Request) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.redirect(new URL("/", request.url));
  // ?self=1 lets any HR reviewer connect their OWN calendar (so they can be
  // assigned as a role's interviewer); the shared HR calendar stays admin-only.
  const self = new URL(request.url).searchParams.get("self") === "1";
  if (self) {
    if (user.canReviewRole !== true) return NextResponse.json({ success: false, error: "Only HR reviewers can connect a personal calendar." }, { status: 403 });
  } else if (user.canEditSettings !== true) return NextResponse.json({ success: false, error: "Only settings administrators can connect the shared HR calendar." }, { status: 403 });
  const rate = consumeRateLimit(`calendar-connect:${user.email}:${requestClientKey(request)}`, 10, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many calendar connection attempts. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  try {
    const calendarConfig = self ? { email: user.email.trim().toLowerCase() } : await getFinalInterviewCalendarConfig();
    // An organization that has not chosen a shared calendar yet uses the
    // administrator who is connecting it, and remembers that choice.
    if (!self && !calendarConfig.email) {
      const template = defaultPortalSettings.find((setting) => setting.key === "Final_Interview_Calendar_Email");
      if (!template) throw new Error("Final_Interview_Calendar_Email setting is not defined.");
      calendarConfig.email = user.email.trim().toLowerCase();
      await upsertPortalSettings([{ ...template, value: calendarConfig.email, updatedAt: new Date().toISOString(), updatedBy: user.email }]);
    }
    // Use the host that initiated OAuth so custom-domain deployments do not
    // accidentally exchange the authorization code against localhost.
    const url = getGoogleConsentUrl(calendarConfig.email, new URL(request.url).origin);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("[Google Calendar] Failed to build consent URL:", error);
    return NextResponse.json({ success: false, error: "Calendar connection is not configured yet." }, { status: 500 });
  }
}
