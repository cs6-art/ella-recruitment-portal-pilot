import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { demoActionBlockReason } from "@/lib/candidate-applications";
import { z } from "zod";

import { canDeleteApplicant, canEditApplicant } from "@/lib/access-control";
import { deleteApplicant, isPreferredMobileValid, normalizePreferredMobile, updateApplicantProfile } from "@/lib/applicant-workflow";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ applicationId: string }> };

const applicantUpdateSchema = z.object({
  candidateName: z.string().trim().min(3).max(150),
  email: z.string().trim().email().max(320),
  preferredMobile: z.string().trim().min(8).max(50),
  applicantCountry: z.enum(["PH", "SG", "MY"]).default("PH"),
});

async function getUser() {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(COOKIE_NAME)?.value);
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
    if (!canEditApplicant(user)) return NextResponse.json({ success: false, error: "You do not have permission to edit applicants." }, { status: 403 });
    const { applicationId } = await context.params;
    const input = applicantUpdateSchema.parse(await request.json());
    if (!isPreferredMobileValid(normalizePreferredMobile(input.preferredMobile))) {
      return NextResponse.json({ success: false, error: "Enter a valid local mobile number for the selected country.", field: "preferredMobile" }, { status: 422 });
    }
    // Demo mode: protect real applicant records from presentation clicks.
    const blocked = await demoActionBlockReason(applicationId);
    if (blocked) return NextResponse.json({ success: false, error: blocked }, { status: 503 });
    const result = await updateApplicantProfile(applicationId, input);
    return NextResponse.json({ success: true, applicant: result, message: "Applicant details updated successfully." });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to update the applicant." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
    if (!canDeleteApplicant(user)) return NextResponse.json({ success: false, error: "You do not have permission to delete applicants." }, { status: 403 });
    const { applicationId } = await context.params;
    // Demo mode: protect real applicant records from presentation clicks.
    const blocked = await demoActionBlockReason(applicationId);
    if (blocked) return NextResponse.json({ success: false, error: blocked }, { status: 503 });
    const result = await deleteApplicant(applicationId);
    return NextResponse.json({ success: true, applicant: result, message: "Applicant and linked records deleted successfully." });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to delete the applicant." }, { status: 400 });
  }
}
