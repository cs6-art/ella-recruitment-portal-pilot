import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { canDecideApplicant } from "@/lib/access-control";
import { sendVoiceBookingInvitation } from "@/lib/applicant-workflow";
import { getPublicAppBaseUrl } from "@/lib/public-url";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

function publicBookingError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/still scheduled or in progress/i.test(message)) return message;
  if (/only after an unanswered or incomplete/i.test(message)) return message;
  if (/technically|provider issue|side-effect window/i.test(message)) return message;
  return "Unable to send a new voice interview booking link. Please try again.";
}

export async function POST(request: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user || !canDecideApplicant(user)) {
    return NextResponse.json({ error: "You are not authorized to send interview invitations." }, { status: 403 });
  }
  const rate = consumeRateLimit(`voice-booking:${user.email}:${requestClientKey(request)}`, 20, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many booking-link requests. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  try {
    const applicationId = decodeURIComponent((await params).applicationId);
    const result = await sendVoiceBookingInvitation(applicationId, { name: user.name, email: user.email }, getPublicAppBaseUrl(request));
    revalidatePath(`/applicants/${encodeURIComponent(applicationId)}`);
    revalidatePath("/applicants");
    revalidatePath("/dashboard");
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json({ error: publicBookingError(error) }, { status: 400 });
  }
}
