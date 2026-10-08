import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getCreditBalance, getCreditPricing } from "@/lib/ella-credits";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight balance read for any authenticated portal user, so operational
// screens (e.g. bulk resume screening) can show remaining credits without
// exposing the full ledger, which stays settings-admin only.
export async function GET() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  try {
    const [{ balance, held, available }, pricing] = await Promise.all([getCreditBalance({ organizationId: user.organizationId, ownerEmail: user.email }), getCreditPricing()]);
    // `available` is what new work may spend: the balance minus credits reserved
    // by booked interviews. Sheet-backed balances have no holds, so they fall back to the balance.
    return NextResponse.json({ success: true, balance, available: available ?? balance, held: held ?? 0, pricing }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Smile Credits Balance] GET failed:", error);
    return NextResponse.json({ success: false, error: "Unable to load the Smile Credits balance." }, { status: 500 });
  }
}
