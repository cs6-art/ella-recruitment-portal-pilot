import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { canEditRecruitmentSetup, canViewRole } from "@/lib/access-control";
import { getRoleRequestById } from "@/lib/google-sheets";
import { countRoleResumeReview, getRole, setRoleInterviewAutomation } from "@/lib/internal-recruitment-queries";
import { nextInterviewAutomation, readInterviewAutomation } from "@/lib/interview-automation";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { isRoleOpenForSelection } from "@/lib/recruitment-role-eligibility";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ roleId: string }> };

// The condition can be set from the Role Request stage onward. It only acts once
// the role is live (checked again when an applicant is screened), so a rejected
// role is the only status that cannot take it.
const CLOSED_ROLE_STATUSES = new Set(["rejected"]);
const roleAcceptsSetting = (role: { status: string; targetHiringDate: string | null }) => !CLOSED_ROLE_STATUSES.has(role.status.toLowerCase()) && isRoleOpenForSelection({ targetHiringDate: role.targetHiringDate });
const bodySchema = z.object({ enabled: z.boolean(), minScore: z.coerce.number().int().min(1).max(100) });

async function loadRole(context: Context) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return { response: NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 }) };
  if (!isPostgresRecruitmentTarget()) return { response: NextResponse.json({ success: false, error: "Not available." }, { status: 404 }) };
  let roleId = "";
  try { roleId = decodeURIComponent((await context.params).roleId).trim(); } catch { /* invalid reference */ }
  const summary = roleId ? await getRoleRequestById(roleId) : null;
  if (!summary || !canViewRole(user, summary)) return { response: NextResponse.json({ success: false, error: "Role request not found." }, { status: 404 }) };
  const role = await getRole(roleId, user.organizationId);
  if (!role) return { response: NextResponse.json({ success: false, error: "Role request not found." }, { status: 404 }) };
  return { user, roleId, role };
}

function payload(setup: unknown, waitingForReview: number, role: { status: string; targetHiringDate: string | null }) {
  return {
    success: true,
    automation: readInterviewAutomation(setup),
    waitingForReview,
    roleOpen: roleAcceptsSetting(role),
    roleLive: ["approved", "recruitment_setup", "job_posted"].includes(role.status.toLowerCase()),
  };
}

/** The role's Interview automation setting and how many applicants still wait for HR review. */
export async function GET(_request: Request, context: Context) {
  const loaded = await loadRole(context);
  if ("response" in loaded) return loaded.response;
  const waiting = await countRoleResumeReview(loaded.roleId, loaded.user.organizationId);
  return NextResponse.json(payload(loaded.role.setup, waiting, loaded.role), { headers: { "Cache-Control": "no-store" } });
}

/** Switch Interview automation on or off, or change its minimum score. */
export async function PUT(request: Request, context: Context) {
  const loaded = await loadRole(context);
  if ("response" in loaded) return loaded.response;
  const { user, roleId, role } = loaded;
  if (!canEditRecruitmentSetup(user)) return NextResponse.json({ success: false, error: "Only HR can change Interview automation." }, { status: 403 });
  const rate = consumeRateLimit(`interview-automation:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many changes. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Enter a minimum score from 1 to 100." }, { status: 422 });
  if (parsed.data.enabled && !roleAcceptsSetting(role)) {
    return NextResponse.json({ success: false, error: "Interview automation isn't available for a rejected role or one past its target hiring date." }, { status: 409 });
  }

  try {
    const current = readInterviewAutomation(role.setup);
    const next = nextInterviewAutomation(current, parsed.data, user.email);
    const comments = next.enabled
      ? current.enabled
        ? `Interview automation minimum changed to ${next.minScore}%.`
        : `Interview automation switched on at ${next.minScore}%. Applies to applicants screened from now on.`
      : "Interview automation switched off. New applicants wait for HR review.";
    const updated = await setRoleInterviewAutomation({ externalId: roleId, organizationId: user.organizationId, value: next, actorEmail: user.email, actorName: user.name, comments });
    if (!updated) return NextResponse.json({ success: false, error: "Role request not found." }, { status: 404 });
    revalidatePath(`/roles/${encodeURIComponent(roleId)}`);
    const waiting = await countRoleResumeReview(roleId, user.organizationId);
    return NextResponse.json(payload(updated.setup, waiting, role));
  } catch (error) {
    console.error("[API Interview Automation] PUT failed:", error);
    return NextResponse.json({ success: false, error: "Unable to save Interview automation. Please try again." }, { status: 500 });
  }
}
