import { NextResponse } from "next/server";

import { isDemoMode } from "@/lib/demo-mode";
import { cleanupExpiredResumeFiles } from "@/lib/resume-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function suppliedSecret(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return (bearer || request.headers.get("x-cron-secret") || "").trim();
}

/** Explicit scheduler endpoint; no process-local timer is used on Vercel. */
export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV !== "production") {
    return NextResponse.json({ ok: true, skipped: "non_production" });
  }
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return NextResponse.json({ ok: false, error: "cleanup_not_configured" }, { status: 503 });
  if (suppliedSecret(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (isDemoMode()) return NextResponse.json({ ok: true, skipped: "demo_mode" });
  try {
    const result = await cleanupExpiredResumeFiles();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[Resume Cleanup] Explicit cleanup failed:", error);
    return NextResponse.json({ ok: false, error: "cleanup_failed" }, { status: 500 });
  }
}
