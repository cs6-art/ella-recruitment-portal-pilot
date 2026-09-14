import { NextResponse } from "next/server";

import { isDemoMode } from "@/lib/demo-mode";
import { reconcileBulkResumeQueue } from "@/lib/candidate-applications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function suppliedSecret(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return (bearer || request.headers.get("x-cron-secret") || "").trim();
}

/** Persist stale bulk states so the UI does not depend on a read-time repair. */
export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV !== "production") {
    return NextResponse.json({ ok: true, skipped: "non_production" });
  }
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return NextResponse.json({ ok: false, error: "reconciliation_not_configured" }, { status: 503 });
  if (suppliedSecret(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (isDemoMode()) return NextResponse.json({ ok: true, skipped: "demo_mode" });
  try {
    return NextResponse.json({ ok: true, ...(await reconcileBulkResumeQueue()) });
  } catch (error) {
    console.error("[Bulk Queue] Scheduled reconciliation failed:", error);
    return NextResponse.json({ ok: false, error: "reconciliation_failed" }, { status: 500 });
  }
}
