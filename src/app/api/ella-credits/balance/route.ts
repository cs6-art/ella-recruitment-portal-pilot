import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getCreditBalance, getCreditPricing } from "@/lib/ella-credits";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight balance read for any authenticated portal user, so operational
// screens (e.g. bulk resume screening) can show remaining credits without
// exposing the full ledger, which stays settings-admin only.
export async function GET() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  try {
    const [{ balance }, pricing] = await Promise.all([getCreditBalance({ organizationId: user.organizationId, ownerEmail: user.email }), getCreditPricing()]);
    return NextResponse.json({ success: true, balance, pricing }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Ella Credits Balance] GET failed:", error);
    return NextResponse.json({ success: false, error: "Unable to load the Ella Credits balance." }, { status: 500 });
  }
}
