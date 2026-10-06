import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canManageInterviewAvailability } from "@/lib/access-control";
import { getCalendarBusyWindows } from "@/lib/google-calendar";
import { calendarLookupStatus } from "@/lib/calendar-lookup-status";
import { getRoleRequests } from "@/lib/google-sheets";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { targetRoleSummaries } from "@/lib/recruitment-target-portal";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (user.canReviewRole !== true && user.canApproveRole !== true) {
    return NextResponse.json({ success: false, error: "You are not authorized to view calendar conflicts." }, { status: 403 });
  }

  try {
    const roles = isPostgresRecruitmentTarget() ? await targetRoleSummaries() : await getRoleRequests();
    const start = new Date();
    const end = new Date(start.getTime() + 180 * 24 * 60 * 60 * 1000);
    // Keep connection failures separate from temporary lookup errors. An
    // empty busy list alone proves neither connectivity nor availability.
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
        const status = calendarLookupStatus(result);
        return [role.roleId, { busy: result.checked ? result.busy : [], connected: status === "error" ? null : status === "ready", status }] as const;
      }));

    return NextResponse.json({
      success: true,
      busyWindows: Object.fromEntries(entries.map(([roleId, value]) => [roleId, value.busy])),
      calendarConnected: Object.fromEntries(entries.map(([roleId, value]) => [roleId, value.connected])),
      calendarStatus: Object.fromEntries(entries.map(([roleId, value]) => [roleId, value.status])),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("[Bookings Calendar] Conflict lookup failed:", error);
    return NextResponse.json({ success: false, error: "Unable to load calendar conflicts." }, { status: 500 });
  }
}
