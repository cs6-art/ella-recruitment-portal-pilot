import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { canManageCredits } from "@/lib/access-control";
import { getCreditBalance, getCreditPricing, recordTopUp } from "@/lib/ella-credits";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manual / demo credit top-up. Positive whole number only, a mandatory reason,
// and an optional external reference. Every adjustment is an immutable ledger
// entry that records the actor, amount, reason, reference, timestamp, and
// resulting balance — there is no path that edits the balance without one.
const topUpSchema = z.object({
  amount: z
    .number()
    .int("Amount must be a whole number.")
    .positive("Amount must be greater than zero.")
    .max(1_000_000, "Amount is out of range."),
  note: z.string().trim().min(1, "A reason is required.").max(500),
  reference: z.string().trim().max(200).optional(),
});

async function currentUser() {
  return verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (!canManageCredits(user)) return NextResponse.json({ success: false, error: "Ella Credits permission required." }, { status: 403 });
  try {
    const [{ balance, totals, entries }, pricing] = await Promise.all([getCreditBalance({ organizationId: user.organizationId, ownerEmail: user.email }), getCreditPricing()]);
    return NextResponse.json({
      success: true,
      balance,
      totals,
      entries: entries.slice(-100).reverse(),
      pricing,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Ella Credits] GET failed:", error);
    return NextResponse.json({ success: false, error: "Unable to load the Ella Credits ledger." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (!canManageCredits(user)) return NextResponse.json({ success: false, error: "Ella Credits permission required." }, { status: 403 });

  const rate = consumeRateLimit(`ella-credits:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many credit updates. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  try {
    const parsed = topUpSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || "Enter a positive whole number and a short reason." },
        { status: 422 },
      );
    }
    // Stable idempotency key so a double-submit (network retry) does not add
    // credits twice: actor + amount + reason + reference, per 15-minute window.
    const window = Math.floor(Date.now() / (15 * 60 * 1000));
    const idempotencyKey =
      request.headers.get("Idempotency-Key")?.trim() ||
      `manual:${user.email}:${parsed.data.amount}:${parsed.data.note}:${parsed.data.reference || ""}:${window}`;

    const { balance, totals, bonus } = await recordTopUp({
      amount: parsed.data.amount,
      event: "manual_topup",
      note: parsed.data.note,
      reference: parsed.data.reference,
      idempotencyKey,
      actorName: user.name,
      actorEmail: user.email,
      organizationId: user.organizationId,
    });
    const message = bonus > 0
      ? `Added ${parsed.data.amount} credits plus a ${bonus}-credit volume discount. Balance is now ${balance}.`
      : `Added ${parsed.data.amount} credits. Balance is now ${balance}.`;
    return NextResponse.json({
      success: true,
      balance,
      totals,
      bonus,
      message,
      actor: { name: user.name, email: user.email },
      amount: parsed.data.amount,
      reason: parsed.data.note,
      reference: parsed.data.reference || "",
    });
  } catch (error) {
    console.error("[API Ella Credits] POST failed:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to update the balance." }, { status: 500 });
  }
}
