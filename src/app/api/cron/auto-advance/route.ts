import { NextResponse } from "next/server";

import { sweepAutoAdvance } from "@/lib/auto-advance";
import { isDemoMode } from "@/lib/demo-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function suppliedSecret(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return (bearer || request.headers.get("x-cron-secret") || "").trim();
}

/**
 * Retry net for Interview automation: invite screened applicants the
 * post-screening hook missed, and repair approvals whose invitation write
 * failed. Every action is idempotent, so overlapping runs are harmless.
 */
export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV !== "production") {
    return NextResponse.json({ ok: true, skipped: "non_production" });
  }
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return NextResponse.json({ ok: false, error: "auto_advance_not_configured" }, { status: 503 });
  if (suppliedSecret(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (isDemoMode()) return NextResponse.json({ ok: true, skipped: "demo_mode" });
  try {
    return NextResponse.json({ ok: true, ...(await sweepAutoAdvance({ limit: 100 })) });
  } catch (error) {
    console.error("[Interview automation] Scheduled sweep failed:", error);
    return NextResponse.json({ ok: false, error: "auto_advance_failed" }, { status: 500 });
  }
}
