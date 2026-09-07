import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canManageInterviewAvailability, canManagePipeline } from "@/lib/access-control";
import { createInterviewSlot } from "@/lib/applicant-workflow";
import { getRoleRequestById } from "@/lib/google-sheets";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";

export async function POST(request: Request) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user || !canManagePipeline(user)) return NextResponse.json({ error: "You are not authorized to manage interview availability." }, { status: 403 });
  const rate = consumeRateLimit(`slot-create:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many availability updates. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });
  try {
    const body = await request.json();
    const roleId = String(body.roleId ?? "").trim();
    const role = isPostgresRecruitmentTarget() ? null : await getRoleRequestById(roleId);
    if (!isPostgresRecruitmentTarget() && (!role || !canManageInterviewAvailability(role.status))) throw new Error("Interview availability can only be added for approved or active recruitment roles.");
    if (body.interviewType === "Final Interview") throw new Error("HR interview availability is managed automatically through the connected HR Google Calendar.");
    const slot = await createInterviewSlot({ interviewType: body.interviewType, roleId, date: body.date, startTime: body.startTime, endTime: body.endTime, timezone: body.timezone });
    return NextResponse.json({ success: true, slot }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create interview availability." }, { status: 400 });
  }
}
