import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canEditRecruitmentSetup, canViewRole } from "@/lib/access-control";
import { getRoleRequestById } from "@/lib/google-sheets";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ roleId: string }> };

export async function POST(_request: Request, context: Context) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });

  const { roleId: encodedRoleId } = await context.params;
  const roleId = decodeURIComponent(encodedRoleId);
  const role = await getRoleRequestById(roleId);
  if (!role || !canViewRole(user, role)) return NextResponse.json({ success: false, error: "Role request not found." }, { status: 404 });
  if (!canEditRecruitmentSetup(user)) return NextResponse.json({ success: false, error: "Only HR can manage interview availability." }, { status: 403 });
  // Keep this legacy endpoint explicit so older clients cannot reintroduce
  // manually entered final-interview windows after the calendar migration.
  return NextResponse.json({ success: false, error: "Manual HR availability windows are no longer used. HR interview availability comes from the connected HR Google Calendar." }, { status: 409 });
}
