import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";

import { getTenantDb as getDb } from "@/db/client";
import { applicationStatusHistory } from "@/db/schema-recruitment";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { pilotOutboundEmailEnabled } from "@/lib/pilot-email-policy";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Exposes only the current organization's delivery counts for operational
// follow-up. It never returns recipients or message content.
export async function GET() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  const enabled = pilotOutboundEmailEnabled();
  if (!isPostgresRecruitmentTarget()) return NextResponse.json({ success: true, enabled, sent: 0, pending: 0, failed: 0, notConfigured: 0 }, { headers: { "Cache-Control": "no-store" } });
  try {
    const rows = await getDb().select({ status: applicationStatusHistory.notificationStatus, count: sql<number>`count(*)::int` })
      .from(applicationStatusHistory)
      .where(and(eq(applicationStatusHistory.organizationId, user.organizationId), ne(applicationStatusHistory.notificationStatus, "")))
      .groupBy(applicationStatusHistory.notificationStatus);
    const count = (status: string) => rows.find((row) => row.status === status)?.count ?? 0;
    return NextResponse.json({ success: true, enabled, sent: count("sent"), pending: count("pending"), failed: count("failed"), notConfigured: count("not_configured") }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Notification Health] GET failed:", error);
    return NextResponse.json({ success: false, error: "Unable to check email delivery." }, { status: 500 });
  }
}
