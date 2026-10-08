import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/db/client";
import { isPlatformAdmin } from "@/lib/access-control";
import { getLaunchMonitorSnapshot } from "@/lib/launch-monitor";
import { setLaunchPromotionActive } from "@/lib/launch-promotion";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function requirePlatformAdmin() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return { error: json({ success: false, error: "Authentication required." }, 401) } as const;
  if (!isPlatformAdmin(user)) return { error: json({ success: false, error: "Only a McLink platform administrator can use the Launch Monitor." }, 403) } as const;
  return { user } as const;
}

/** Promotion progress and per-organization balances. Platform administrators only. */
export async function GET() {
  const access = await requirePlatformAdmin();
  if ("error" in access) return access.error;
  try {
    return json({ success: true, ...(await getLaunchMonitorSnapshot()) });
  } catch (error) {
    console.error("[API Launch Monitor] GET failed:", error instanceof Error ? error.message : error);
    return json({ success: false, error: "Unable to load the Launch Monitor. If this is the first time, apply database migration 0041." }, 500);
  }
}

const toggleSchema = z.object({ active: z.boolean() });

/** Switch the Event Welcome promotion on or off. It never changes a balance. */
export async function POST(request: Request) {
  const access = await requirePlatformAdmin();
  if ("error" in access) return access.error;
  const parsed = toggleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ success: false, error: "Choose whether the promotion is on or off." }, 400);
  try {
    const promotion = await setLaunchPromotionActive(getDb(), parsed.data.active);
    if (!promotion) return json({ success: false, error: "The promotion is not set up yet. Apply database migration 0041." }, 404);
    return json({ success: true, promotion });
  } catch (error) {
    console.error("[API Launch Monitor] POST failed:", error instanceof Error ? error.message : error);
    return json({ success: false, error: "Unable to update the promotion." }, 500);
  }
}
