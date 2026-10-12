import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  acknowledgeApplicantReview,
  dismissOnboardingCompletion,
  getOnboardingState,
  OnboardingActionError,
  recordSampleRole,
} from "@/lib/onboarding-store";
import { ONBOARDING_PERMISSION_MESSAGE } from "@/lib/onboarding";
import { consumeRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status, headers: noStore });
}

/** The signed-in organization's guided-setup state. Steps and counts only; never candidate details. */
export async function GET() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return fail("Please sign in.", 401);
  try {
    const onboarding = await getOnboardingState(user.organizationId, user);
    if (!onboarding) return fail("We could not find this workspace.", 404);
    return NextResponse.json({ success: true, onboarding }, { headers: noStore });
  } catch (error) {
    console.error("[API Onboarding] GET failed:", error);
    return fail("Setup progress is temporarily unavailable.", 500);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("acknowledge_review"), applicationId: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("record_sample_role"), roleId: z.string().trim().min(1).max(120), sampleJobId: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal("dismiss_completion") }),
]);

export async function POST(request: Request) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return fail("Please sign in.", 401);
  const rate = consumeRateLimit(`onboarding:${user.email}`, 60, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many requests. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Invalid onboarding action.", 422);
  const input = parsed.data;
  try {
    // Onboarding never grants a permission: each action needs the access the
    // underlying recruitment task already requires.
    if (input.action === "acknowledge_review") {
      if (user.canReviewRole !== true) return fail(ONBOARDING_PERMISSION_MESSAGE, 403);
      await acknowledgeApplicantReview(user.organizationId, input.applicationId);
    } else if (input.action === "record_sample_role") {
      if (user.canCreateRole !== true) return fail(ONBOARDING_PERMISSION_MESSAGE, 403);
      await recordSampleRole(user.organizationId, input.roleId, input.sampleJobId);
    } else {
      if (user.canReviewRole !== true && user.canCreateRole !== true) return fail(ONBOARDING_PERMISSION_MESSAGE, 403);
      await dismissOnboardingCompletion(user.organizationId);
    }
    const onboarding = await getOnboardingState(user.organizationId, user);
    return NextResponse.json({ success: true, onboarding }, { headers: noStore });
  } catch (error) {
    if (error instanceof OnboardingActionError) return fail(error.message, error.status);
    console.error("[API Onboarding] POST failed:", error);
    return fail("We could not save setup progress. Please try again.", 500);
  }
}
