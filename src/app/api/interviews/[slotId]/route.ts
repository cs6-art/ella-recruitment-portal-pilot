import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { canManagePipeline } from "@/lib/access-control";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { targetCancelFinalInterview, targetRescheduleFinalInterview } from "@/lib/recruitment-target-portal";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reschedule"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().trim().max(100).optional(),
  }),
  z.object({
    action: z.literal("cancel"),
    offerNewTime: z.boolean().optional().default(true),
    reason: z.string().trim().max(2000).optional().default(""),
  }),
]);

/** HR reschedules or cancels a booked face-to-face interview from the Interview Calendar. */
export async function PATCH(request: Request, { params }: { params: Promise<{ slotId: string }> }) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user || !canManagePipeline(user)) return NextResponse.json({ success: false, error: "You are not authorized to change interviews." }, { status: 403 });
  if (!isPostgresRecruitmentTarget()) return NextResponse.json({ success: false, error: "Not available." }, { status: 404 });
  const rate = consumeRateLimit(`interview-change:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many interview changes. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Choose a valid date and start time." }, { status: 422 });
  let slotId = "";
  try { slotId = decodeURIComponent((await params).slotId).trim(); } catch { /* invalid reference */ }
  if (!slotId) return NextResponse.json({ success: false, error: "Interview not found." }, { status: 404 });

  try {
    const actor = { name: user.name, email: user.email };
    const result = parsed.data.action === "reschedule"
      ? await targetRescheduleFinalInterview({ slotId, organizationId: user.organizationId, date: parsed.data.date, startTime: parsed.data.startTime, timezone: parsed.data.timezone, actor })
      : await targetCancelFinalInterview({ slotId, organizationId: user.organizationId, offerNewTime: parsed.data.offerNewTime, reason: parsed.data.reason, actor });
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    revalidatePath("/bookings");
    revalidatePath("/applicants");
    revalidatePath("/dashboard");
    return NextResponse.json({ success: true, message: result.message, calendarSync: result.calendarSync });
  } catch (error) {
    console.error("[API Interviews] PATCH failed:", error);
    return NextResponse.json({ success: false, error: "The interview could not be changed. Please try again." }, { status: 500 });
  }
}
