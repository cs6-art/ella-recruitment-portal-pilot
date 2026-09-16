import { NextResponse } from "next/server";

import { isDemoMode } from "@/lib/demo-mode";
import { reconcileStaleVoiceAttempts } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function suppliedSecret(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return (bearer || request.headers.get("x-cron-secret") || "").trim();
}

/** Reconcile provider dispatches that never received a terminal callback. */
export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV !== "production") {
    return NextResponse.json({ ok: true, skipped: "non_production" });
  }
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return NextResponse.json({ ok: false, error: "reconciliation_not_configured" }, { status: 503 });
  if (suppliedSecret(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (isDemoMode()) return NextResponse.json({ ok: true, skipped: "demo_mode" });
  try {
    return NextResponse.json({ ok: true, ...(await reconcileStaleVoiceAttempts()) });
  } catch (error) {
    console.error("[Voice Attempts] Scheduled reconciliation failed:", error);
    return NextResponse.json({ ok: false, error: "reconciliation_failed" }, { status: 500 });
  }
}
