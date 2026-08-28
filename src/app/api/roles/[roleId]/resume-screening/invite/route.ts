import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { canManagePipeline } from "@/lib/access-control";
import { sendApplicationInviteEmail } from "@/lib/application-invite-email";
import { getRoleRequestById, isPublishedRoleForIntake } from "@/lib/google-sheets";
import { getPortalConfig } from "@/lib/portal-config";
import { resolvePublicAppBaseUrl } from "@/lib/public-url";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { createResumeScreeningInvitation } from "@/lib/resume-screening-invite";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  candidateName: z.string().trim().min(2).max(150),
  candidateEmail: z.string().trim().email().max(320),
  sendEmail: z.boolean().optional().default(false),
});

function responseError(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: Request, context: { params: Promise<{ roleId: string }> }) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return responseError("Authentication required.", 401);
  if (!canManagePipeline(user)) {
    return responseError("Only HR reviewers can generate application links.", 403);
  }

  const rate = consumeRateLimit(`resume-screening-invite:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many links generated. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  const { roleId: routeRoleId } = await context.params;
  let roleId: string;
  try {
    roleId = decodeURIComponent(routeRoleId || "").trim();
  } catch {
    return responseError("Invalid role reference.", 400);
  }

  const role = await getRoleRequestById(roleId);
  if (!role || !isPublishedRoleForIntake(role)) {
    return responseError("The selected role is not published for applications.", 409);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return responseError("Enter the candidate's full name and email address.", 422);

  // The static candidate page may live on a separate domain. Keep that page
  // URL independent from N8N_BULK_RESUME_PORTAL_BASE_URL, which is also used
  // by n8n to reach this portal for resume extraction.
  const portalConfig = await getPortalConfig();
  const configuredBaseUrl =
    portalConfig.Resume_Screening_Invite_Base_URL.trim().replace(/\/$/, "") ||
    portalConfig.N8N_Bulk_Resume_Portal_Base_URL.trim().replace(/\/$/, "");
  const baseUrl = configuredBaseUrl || (await resolvePublicAppBaseUrl(request));

  try {
    const invitation = await createResumeScreeningInvitation({
      roleId: role.roleId,
      roleTitle: role.jobTitle,
      candidateName: parsed.data.candidateName,
      candidateEmail: parsed.data.candidateEmail,
      createdByName: user.name,
      createdByEmail: user.email,
      baseUrl,
    });
    const email: { status: string; error?: string } = parsed.data.sendEmail
      ? await sendApplicationInviteEmail({
        invitationId: invitation.invitationId,
        roleId: role.roleId,
        roleTitle: role.jobTitle,
        candidateName: parsed.data.candidateName,
        candidateEmail: parsed.data.candidateEmail,
        link: invitation.link,
        expiresAt: invitation.expiresAt,
        createdByName: user.name,
        createdByEmail: user.email,
      })
      : { status: "not_requested" };
    return NextResponse.json({
      success: true,
      link: invitation.link,
      token: invitation.token,
      expiresAt: invitation.expiresAt,
      emailStatus: email.status,
      emailError: email.error || "",
    });
  } catch (error) {
    console.error("[API Resume Screening Invite] POST failed:", error);
    return responseError("Unable to generate the application link.", 500);
  }
}
