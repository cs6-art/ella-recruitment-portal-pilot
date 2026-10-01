import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { canManageCredits } from "@/lib/access-control";
import { creditPacks, ELLA_CREDIT_PRICE_CENTS, MAX_CUSTOM_CREDITS, MIN_CUSTOM_CREDITS } from "@/lib/credit-packs";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { createCreditPurchase, isPaymentsConfigured, listRecentPayments, PaymentError } from "@/lib/payments";
import { hitpayMode } from "@/lib/hitpay";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.union([
  z.object({ packId: z.string().trim().min(1).max(64) }),
  z.object({ credits: z.number().int().min(MIN_CUSTOM_CREDITS).max(MAX_CUSTOM_CREDITS) }),
]);

async function currentUser() {
  return verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
}

function appOrigin(request: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });

  const configured = isPaymentsConfigured();
  const packs = creditPacks().map((pack) => ({ id: pack.id, label: pack.label, credits: pack.credits, amountCents: pack.amountCents, currency: pack.currency }));
  let recent: Array<Record<string, unknown>> = [];
  if (configured && canManageCredits(user)) {
    try {
      recent = (await listRecentPayments(50)).map((row) => ({
        reference: row.reference,
        status: row.status,
        credits: row.credits,
        amountCents: row.amountCents,
        currency: row.currency,
        packId: row.packId,
        actorEmail: row.actorEmail,
        createdAt: row.createdAt,
        creditedAt: row.creditedAt,
      }));
    } catch (error) {
      console.error("[API Payments] list failed:", error);
    }
  }
  return NextResponse.json({ success: true, configured, mode: hitpayMode(), packs, custom: { priceCents: ELLA_CREDIT_PRICE_CENTS, min: MIN_CUSTOM_CREDITS, max: MAX_CUSTOM_CREDITS, currency: "SGD" }, recent }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });

  if (!isPaymentsConfigured()) {
    return NextResponse.json(
      { success: false, code: "NOT_CONFIGURED", error: "Credit purchases are not available yet. Please contact your administrator." },
      { status: 503 },
    );
  }

  const rate = consumeRateLimit(`credit-purchase:${user.email}:${requestClientKey(request)}`, 10, 15 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json({ success: false, error: "Too many payment attempts. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: `Choose a credit pack or enter ${MIN_CUSTOM_CREDITS}-${MAX_CUSTOM_CREDITS} credits.` }, { status: 422 });

  try {
    const result = await createCreditPurchase({
      ...("packId" in parsed.data ? { packId: parsed.data.packId } : { credits: parsed.data.credits }),
      actorEmail: user.email,
      actorName: user.name,
      organizationId: user.organizationId,
      origin: appOrigin(request),
      idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || undefined,
    });
    return NextResponse.json({
      success: true,
      reference: result.reference,
      url: result.url,
      amountCents: result.amountCents,
      currency: result.currency,
      credits: result.credits,
    });
  } catch (error) {
    if (error instanceof PaymentError) {
      return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: error.code === "UNKNOWN_PACK" ? 422 : 502 });
    }
    console.error("[API Payments] create failed:", error);
    return NextResponse.json({ success: false, error: "Unable to start the payment." }, { status: 500 });
  }
}
