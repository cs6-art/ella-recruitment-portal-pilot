import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import { interviewRecordingRetentionDays } from "@/lib/live-interview-store";
import { normalizeRecordingRetentionDays } from "@/lib/recording-retention";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

async function readOrganizationDays(organizationId: string) {
  const [row] = await getDb().select({ days: organizations.interviewRecordingRetentionDays }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return row?.days ?? null;
}

/** The organization's recording retention and the platform default it falls back to. */
export async function GET() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401, headers: NO_STORE });
  if (user.canEditSettings !== true) return NextResponse.json({ success: false, error: "Settings permission required." }, { status: 403, headers: NO_STORE });
  try {
    return NextResponse.json({ success: true, days: await readOrganizationDays(user.organizationId), platformDays: interviewRecordingRetentionDays() }, { headers: NO_STORE });
  } catch (error) {
    console.error("[Recording Retention] Read failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: "Unable to load the recording retention setting." }, { status: 500, headers: NO_STORE });
  }
}

/** Sets how long this organization keeps interview recordings. Blank returns to the platform default. */
export async function PUT(request: Request) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401, headers: NO_STORE });
  if (user.canEditSettings !== true) return NextResponse.json({ success: false, error: "Settings permission required." }, { status: 403, headers: NO_STORE });
  const rate = consumeRateLimit(`recording-retention:${user.organizationId}:${user.email}:${requestClientKey(request)}`, 20, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many changes. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  const body = await request.json().catch(() => null) as { days?: unknown } | null;
  let days: number | null;
  try {
    days = normalizeRecordingRetentionDays(body?.days);
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Choose a valid number of days." }, { status: 400, headers: NO_STORE });
  }

  try {
    await getDb().update(organizations).set({ interviewRecordingRetentionDays: days, updatedAt: new Date() }).where(eq(organizations.id, user.organizationId));
    return NextResponse.json({ success: true, days, platformDays: interviewRecordingRetentionDays() }, { headers: NO_STORE });
  } catch (error) {
    console.error("[Recording Retention] Save failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: "The setting could not be saved. Try again." }, { status: 500, headers: NO_STORE });
  }
}
