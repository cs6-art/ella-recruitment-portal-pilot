import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { demoActionBlockReason } from "@/lib/candidate-applications";
import { z } from "zod";

import { canDeleteApplicant, canEditApplicant } from "@/lib/access-control";
import { deleteApplicant, isPreferredMobileValid, normalizePreferredMobile, updateApplicantProfile } from "@/lib/applicant-workflow";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/safe-error";
import { countryOptions } from "@/lib/country-codes";

const SUPPORTED_COUNTRIES = new Set(countryOptions.map((option) => option.country));

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ applicationId: string }> };

const applicantUpdateSchema = z.object({
  candidateName: z.string().trim().min(3).max(150),
  email: z.string().trim().email().max(320),
  preferredMobile: z.string().trim().min(8).max(50),
  // Any country the form's country picker offers, not only the three we call from.
  applicantCountry: z.string().trim().toUpperCase().refine((value) => SUPPORTED_COUNTRIES.has(value), "Choose a country from the list.").default("PH"),
});

async function getUser() {
  const cookieStore = await cookies();
  return await getActiveSessionUser(cookieStore.get(COOKIE_NAME)?.value);
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
    return NextResponse.json({ success: false, error: publicErrorMessage(error, "Unable to update the applicant.", "API Applicant") }, { status: 400 });
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
    return NextResponse.json({ success: false, error: publicErrorMessage(error, "Unable to delete the applicant.", "API Applicant") }, { status: 400 });
  }
}
