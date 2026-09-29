import { NextResponse } from "next/server";

import { isDemoMode } from "@/lib/demo-mode";
import { purgeExpiredInterviewRecordings } from "@/lib/live-interview-store";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function suppliedSecret(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return (bearer || request.headers.get("x-cron-secret") || "").trim();
}

/** Deletes interview recordings past INTERVIEW_RECORDING_RETENTION_DAYS (default 90; 0 keeps them). */
export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV !== "production") {
    return NextResponse.json({ ok: true, skipped: "non_production" });
  }
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return NextResponse.json({ ok: false, error: "retention_not_configured" }, { status: 503 });
  if (suppliedSecret(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (isDemoMode() || !isPostgresRecruitmentTarget()) return NextResponse.json({ ok: true, skipped: "not_postgres_target" });
  try {
    return NextResponse.json({ ok: true, ...(await purgeExpiredInterviewRecordings()) });
  } catch (error) {
    console.error("[Interview Retention] Sweep failed:", error);
    return NextResponse.json({ ok: false, error: "retention_failed" }, { status: 500 });
  }
}
