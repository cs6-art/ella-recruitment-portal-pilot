import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canManageCredits } from "@/lib/access-control";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { getPaymentByReference, getPaymentForActor, isPaymentsConfigured, reconcilePayment } from "@/lib/payments";
import { getCreditBalance } from "@/lib/ella-credits";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function currentUser() {
  return verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
}

async function paymentVisibleToUser(reference: string, user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) {
  return canManageCredits(user)
    ? getPaymentByReference(reference)
    : getPaymentForActor(reference, user.email);
}

async function view(row: NonNullable<Awaited<ReturnType<typeof getPaymentByReference>>>, organizationId: string) {
  const balance = await getCreditBalance({ fresh: true, organizationId });
  return {
    reference: row.reference,
    status: row.status,
    credits: row.credits,
    amountCents: row.amountCents,
    currency: row.currency,
    packId: row.packId,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    creditedAt: row.creditedAt,
    newBalance: balance.balance,
  };
}

// Poll a payment's status (used by the "return from HitPay" screen).
export async function GET(_request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (!isPaymentsConfigured()) return NextResponse.json({ success: false, code: "NOT_CONFIGURED", error: "Payments are not configured." }, { status: 503 });

  const { reference } = await params;
  const row = await paymentVisibleToUser(reference, user);
  if (!row) return NextResponse.json({ success: false, error: "Payment not found." }, { status: 404 });
  return NextResponse.json({ success: true, payment: await view(row, user.organizationId) }, { headers: { "Cache-Control": "no-store" } });
}

// Force a server-side status pull from HitPay and re-run the transition. Safe
// to call repeatedly (idempotent credit grant). Use when a webhook was missed.
export async function POST(request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (!isPaymentsConfigured()) return NextResponse.json({ success: false, code: "NOT_CONFIGURED", error: "Payments are not configured." }, { status: 503 });

  const rate = consumeRateLimit(`payment-reconcile:${user.email}:${requestClientKey(request)}`, 20, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many reconcile attempts." }, { status: 429, headers: rateLimitHeaders(rate) });

  const { reference } = await params;
  try {
    const visiblePayment = await paymentVisibleToUser(reference, user);
    if (!visiblePayment) return NextResponse.json({ success: false, error: "Payment not found." }, { status: 404 });
    const result = await reconcilePayment(reference);
    const row = await paymentVisibleToUser(reference, user);
    return NextResponse.json({ success: result.ok, outcome: result.outcome, payment: row ? await view(row, user.organizationId) : null });
  } catch (error) {
    console.error("[API Payments] reconcile failed:", error);
    return NextResponse.json({ success: false, error: "Unable to reconcile the payment." }, { status: 502 });
  }
}
