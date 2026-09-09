import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canManagePipeline } from "@/lib/access-control";
import { markInterviewNoShow } from "@/lib/applicant-workflow";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export async function POST(request: Request, { params }: { params: Promise<{ slotId: string }> }) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user || !canManagePipeline(user)) {
    return NextResponse.json({ error: "You are not authorized to update interview status." }, { status: 403 });
  }
  const rate = consumeRateLimit(`slot-status:${user.email}:${requestClientKey(request)}`, 60, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many interview status updates. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  try {
    const result = await markInterviewNoShow(decodeURIComponent((await params).slotId), { email: user.email, name: user.name });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to mark interview as No Show." }, { status: 400 });
  }
}
