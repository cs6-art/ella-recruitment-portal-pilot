import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canManageInterviewAvailability } from "@/lib/access-control";
import { getCalendarBusyWindows } from "@/lib/google-calendar";
import { getRoleRequests } from "@/lib/google-sheets";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { targetRoleSummaries } from "@/lib/recruitment-target-portal";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (user.canReviewRole !== true && user.canApproveRole !== true) {
    return NextResponse.json({ success: false, error: "You are not authorized to view calendar conflicts." }, { status: 403 });
  }

  try {
    const roles = isPostgresRecruitmentTarget() ? await targetRoleSummaries() : await getRoleRequests();
    const start = new Date();
    const end = new Date(start.getTime() + 180 * 24 * 60 * 60 * 1000);
    // Return connection state separately from busy windows. An empty busy
    // list means either a free calendar or an unavailable calendar, so the
    // client must not treat it as proof that final slots are bookable.
    const busyByCalendar = new Map<string, ReturnType<typeof getCalendarBusyWindows>>();
    const entries = await Promise.all(roles
      .filter((role) => canManageInterviewAvailability(role.status))
      .map(async (role) => {
        const calendarKey = (role.hodEmail || "").trim().toLowerCase();
        let resultPromise = busyByCalendar.get(calendarKey);
        if (!resultPromise) {
          resultPromise = getCalendarBusyWindows({ hodEmail: role.hodEmail || "", start, end });
          busyByCalendar.set(calendarKey, resultPromise);
        }
        const result = await resultPromise;
        return [role.roleId, { busy: result.checked ? result.busy : [], connected: result.checked }] as const;
      }));

    return NextResponse.json({
      success: true,
      busyWindows: Object.fromEntries(entries.map(([roleId, value]) => [roleId, value.busy])),
      calendarConnected: Object.fromEntries(entries.map(([roleId, value]) => [roleId, value.connected])),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("[Bookings Calendar] Conflict lookup failed:", error);
    return NextResponse.json({ success: false, error: "Unable to load calendar conflicts." }, { status: 500 });
  }
}
