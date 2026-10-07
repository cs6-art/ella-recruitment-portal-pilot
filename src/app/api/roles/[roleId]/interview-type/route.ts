import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { canEditRecruitmentSetup, canViewRole } from "@/lib/access-control";
import { getRoleRequestById } from "@/lib/google-sheets";
import { getRole, setRoleInterviewType } from "@/lib/internal-recruitment-queries";
import { interviewTypeChangeComment, readRoleInterviewType, ROLE_INTERVIEW_TYPES } from "@/lib/interview-type";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ roleId: string }> };
const bodySchema = z.object({ interviewType: z.enum(ROLE_INTERVIEW_TYPES) }).strict();

async function loadRole(context: Context) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return { response: NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 }) };
  if (!isPostgresRecruitmentTarget()) return { response: NextResponse.json({ success: false, error: "Not available." }, { status: 404 }) };
  let roleId = "";
  try { roleId = decodeURIComponent((await context.params).roleId).trim(); } catch { /* invalid reference */ }
  const summary = roleId ? await getRoleRequestById(roleId) : null;
  if (!summary || !canViewRole(user, summary)) return { response: NextResponse.json({ success: false, error: "Role request not found." }, { status: 404 }) };
  // Organization-scoped lookup: another organization's role reads as missing.
  const role = await getRole(roleId, user.organizationId);
  if (!role) return { response: NextResponse.json({ success: false, error: "Role request not found." }, { status: 404 }) };
  return { user, roleId, role };
}

/** The role's Interview type: Voice Interview only, Avatar Interview only, or Both. */
export async function GET(_request: Request, context: Context) {
  const loaded = await loadRole(context);
  if ("response" in loaded) return loaded.response;
  return NextResponse.json({ success: true, interviewType: readRoleInterviewType(loaded.role.setup), editable: canEditRecruitmentSetup(loaded.user) }, { headers: { "Cache-Control": "no-store" } });
}

/** Change the role's Interview type (HR only). Applies to interviews sent from now on. */
export async function PUT(request: Request, context: Context) {
  const loaded = await loadRole(context);
  if ("response" in loaded) return loaded.response;
  const { user, roleId, role } = loaded;
  if (!canEditRecruitmentSetup(user)) return NextResponse.json({ success: false, error: "Only HR can change the interview type." }, { status: 403 });
  const rate = consumeRateLimit(`interview-type:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many changes. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Choose Voice Interview only, Avatar Interview only, or Both." }, { status: 422 });

  try {
    const previous = readRoleInterviewType(role.setup);
    const updated = await setRoleInterviewType({ externalId: roleId, organizationId: user.organizationId, value: parsed.data.interviewType, actorEmail: user.email, actorName: user.name, comments: interviewTypeChangeComment(previous, parsed.data.interviewType) });
    if (!updated) return NextResponse.json({ success: false, error: "Role request not found." }, { status: 404 });
    if (updated.changed) revalidatePath(`/roles/${encodeURIComponent(roleId)}`);
    return NextResponse.json({ success: true, interviewType: readRoleInterviewType(updated.setup), editable: true, changed: updated.changed });
  } catch (error) {
    console.error("[API Interview Type] PUT failed:", error);
    return NextResponse.json({ success: false, error: "Unable to save the interview type. Please try again." }, { status: 500 });
  }
}
