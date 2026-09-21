import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { canManagePipeline } from "@/lib/access-control";
import { extractResumeText } from "@/lib/resume-files";
import { isLiveAvatarConfigured } from "@/lib/live-avatar";
import { prepareLiveAvatarScreening } from "@/lib/live-avatar-screening";
import { resolvePublishedRecruitmentRole } from "@/lib/recruitment-role-resolution";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!isLiveAvatarConfigured()) return NextResponse.json({ success: false, error: "The live avatar interview is not configured yet." }, { status: 503 });
  try {
    const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
    if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
    if (!canManagePipeline(user)) return NextResponse.json({ success: false, error: "Only HR reviewers can run resume screening." }, { status: 403 });
    const form = await request.formData();
    const roleId = String(form.get("roleId") || "").trim();
    const candidateName = String(form.get("candidateName") || "").trim();
    const file = form.get("resumeFile");
    if (!roleId || !candidateName || !(file instanceof File)) return NextResponse.json({ success: false, error: "Choose a resume and enter your full name first." }, { status: 422 });
    const role = await resolvePublishedRecruitmentRole(roleId, user.organizationId);
    if (!role) return NextResponse.json({ success: false, error: "This role is not currently accepting applications." }, { status: 404 });
    const resumeText = await extractResumeText(file);
    const preparation = prepareLiveAvatarScreening({ roleTitle: role.jobTitle, roleDescription: role.jobDescription || "", resumeText });
    return NextResponse.json({ success: true, preparation, creditsCharged: 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Live Avatar Prepare] POST failed:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to analyze the resume." }, { status: 400 });
  }
}
