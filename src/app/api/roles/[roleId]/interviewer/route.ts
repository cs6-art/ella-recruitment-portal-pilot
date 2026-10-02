import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canEditRecruitmentSetup, canViewRole } from "@/lib/access-control";
import { getCalendarConnection } from "@/lib/calendar-tokens";
import { getFinalInterviewCalendarConfig, getRoleRequestById } from "@/lib/google-sheets";
import { setRoleInterviewer } from "@/lib/internal-recruitment-queries";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";
import { listEligibleInterviewers } from "@/lib/interviewers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ roleId: string }> };

/** Assign (or clear) the interviewer whose own calendar hosts this role's face-to-face interviews. */
export async function PUT(request: Request, context: Context) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (!isPostgresRecruitmentTarget()) return NextResponse.json({ success: false, error: "Not available." }, { status: 404 });
  const { roleId: encodedRoleId } = await context.params;
  const roleId = decodeURIComponent(encodedRoleId);
  const role = await getRoleRequestById(roleId);
  if (!role || !canViewRole(user, role)) return NextResponse.json({ success: false, error: "Role request not found." }, { status: 404 });
  if (!canEditRecruitmentSetup(user)) return NextResponse.json({ success: false, error: "Only HR can assign an interviewer." }, { status: 403 });

  let body: { email?: unknown } = {};
  try { body = await request.json(); } catch { /* treated as an empty body below */ }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  try {
    if (email) {
      const eligible = (await listEligibleInterviewers(user.organizationId)).find((candidate) => candidate.email === email);
      if (!eligible) return NextResponse.json({ success: false, error: "Choose an active HR reviewer from your organization." }, { status: 422 });
      if (!(await getCalendarConnection(email))) return NextResponse.json({ success: false, error: `${eligible.name} has not connected their Google Calendar yet. Ask them to connect it from their Profile page first.` }, { status: 409 });
    }
    const shared = await getFinalInterviewCalendarConfig();
    const updated = await setRoleInterviewer({ externalId: roleId, organizationId: user.organizationId, email, sharedCalendarEmail: shared.email, actorEmail: user.email });
    if (!updated) return NextResponse.json({ success: false, error: "Role request not found." }, { status: 404 });
    return NextResponse.json({ success: true, assignedEmail: updated.email });
  } catch (error) {
    console.error("[API Role Interviewer] PUT failed:", error);
    return NextResponse.json({ success: false, error: "Unable to assign the interviewer." }, { status: 500 });
  }
}
