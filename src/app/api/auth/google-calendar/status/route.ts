import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getCalendarConnection } from "@/lib/calendar-tokens";
import { getCalendarConnectionStatus } from "@/lib/google-calendar";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export async function GET(request: Request) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  if (new URL(request.url).searchParams.get("self") === "1") {
    try {
      const own = await getCalendarConnection(user.email);
      return NextResponse.json({ success: true, connected: Boolean(own?.refreshToken), accountEmail: user.email, connectedAt: own?.connectedAt || "" }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("[Google Calendar] Personal status check failed:", error);
      return NextResponse.json({ success: false, error: "Unable to check calendar connection." }, { status: 500 });
    }
  }

  try {
    const connection = await getCalendarConnectionStatus();
    return NextResponse.json({ success: true, connected: connection.connected, state: connection.state, accountEmail: connection.accountEmail, expectedEmail: connection.expectedEmail, accountMismatch: connection.accountMismatch, connectedAt: connection.connectedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[Google Calendar] Status check failed:", error);
    return NextResponse.json({ success: false, error: "Unable to check calendar connection." }, { status: 500 });
  }
}
