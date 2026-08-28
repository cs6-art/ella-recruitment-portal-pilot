import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCreditBalance, recordTopUp } from "@/lib/ella-credits";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const topUpSchema = z.object({
  amount: z.number().int().refine((value) => value !== 0, "Amount must not be zero.").refine((value) => Math.abs(value) <= 1_000_000, "Amount is out of range."),
  note: z.string().trim().min(1).max(500),
});

async function currentUser() {
  return verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (user.canEditSettings !== true) return NextResponse.json({ success: false, error: "Settings permission required." }, { status: 403 });
  try {
    const { balance, totals, entries } = await getCreditBalance();
    return NextResponse.json({
      success: true,
      balance,
      totals,
      entries: entries.slice(-100).reverse(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Ella Credits] GET failed:", error);
    return NextResponse.json({ success: false, error: "Unable to load the Ella Credits ledger." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (user.canEditSettings !== true) return NextResponse.json({ success: false, error: "Settings permission required." }, { status: 403 });

  const rate = consumeRateLimit(`ella-credits:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many credit updates. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  try {
    const parsed = topUpSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ success: false, error: "Enter a non-zero whole number and a short note." }, { status: 422 });
    const { balance, totals } = await recordTopUp({
      amount: parsed.data.amount,
      note: parsed.data.note,
      actorName: user.name,
      actorEmail: user.email,
    });
    return NextResponse.json({ success: true, balance, totals, message: `Balance updated to ${balance} credits.` });
  } catch (error) {
    console.error("[API Ella Credits] POST failed:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to update the balance." }, { status: 500 });
  }
}
