import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canEditRecruitmentSetup } from "@/lib/access-control";
import { getFinalInterviewCalendarConfig, getRoleRequestById } from "@/lib/google-sheets";
import { listEligibleInterviewers } from "@/lib/interviewers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (!canEditRecruitmentSetup(user)) return NextResponse.json({ success: false, error: "Only HR can view interviewers." }, { status: 403 });
  try {
    const roleId = new URL(request.url).searchParams.get("roleId")?.trim() || "";
    const [interviewers, shared, role] = await Promise.all([
      listEligibleInterviewers(user.organizationId),
      getFinalInterviewCalendarConfig(),
      roleId ? getRoleRequestById(roleId) : Promise.resolve(null),
    ]);
    const roleEmail = (role?.hodEmail || "").trim().toLowerCase();
    const sharedEmail = shared.email.trim().toLowerCase();
    return NextResponse.json({ success: true, interviewers, sharedCalendarEmail: sharedEmail, assignedEmail: roleEmail && roleEmail !== sharedEmail ? roleEmail : "" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Interviewers] GET failed:", error);
    return NextResponse.json({ success: false, error: "Unable to load interviewers." }, { status: 500 });
  }
}
