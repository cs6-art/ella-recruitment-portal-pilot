import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isDatabaseConfigured } from "@/db/client";
import { organizationCreditsEnabled } from "@/lib/ella-credits-accounts";
import { PROMO_CODE_MESSAGES } from "@/lib/promo-code-rules";
import { redeemPromoCode } from "@/lib/promo-codes";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only the code is accepted. The organization comes from the session and the
// credit amount from the stored code, never from the request.
const bodySchema = z.object({ code: z.string().trim().min(1).max(60) }).strict();

/** Redeem a promo code for the signed-in user's organization. */
export async function POST(request: Request) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (!isDatabaseConfigured() || !organizationCreditsEnabled()) {
    return NextResponse.json({ success: false, error: PROMO_CODE_MESSAGES.unavailable }, { status: 503 });
  }
  // Slows down code guessing; a real user needs one or two tries.
  const rate = consumeRateLimit(`promo-redeem:${user.organizationId}:${user.email}:${requestClientKey(request)}`, 10, 15 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json({ success: false, error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429, headers: rateLimitHeaders(rate) });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, reason: "invalid", error: PROMO_CODE_MESSAGES.invalid }, { status: 422 });

  try {
    const result = await redeemPromoCode({ code: parsed.data.code, organizationId: user.organizationId, actorEmail: user.email, actorName: user.name });
    if (!result.ok) {
      const status = result.reason === "invalid" ? 404 : result.reason === "expired" ? 410 : 409;
      return NextResponse.json({ success: false, reason: result.reason, error: PROMO_CODE_MESSAGES[result.reason] }, { status });
    }
    return NextResponse.json({ success: true, credits: result.credits, balance: result.balanceAfter, code: result.code, message: PROMO_CODE_MESSAGES.success }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Promo Code] redeem failed:", error);
    return NextResponse.json({ success: false, error: PROMO_CODE_MESSAGES.error }, { status: 500 });
  }
}
