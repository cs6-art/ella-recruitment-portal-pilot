import { NextResponse } from "next/server";

import { isDemoMode } from "@/lib/demo-mode";
import { recoverStaleLiveInterviews } from "@/lib/live-interview-store";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function suppliedSecret(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return (bearer || request.headers.get("x-cron-secret") || "").trim();
}

/** Backstop: closes abandoned live interviews and resumes stalled processing. */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return NextResponse.json({ ok: false, error: "recovery_not_configured" }, { status: 503 });
  if (suppliedSecret(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (isDemoMode() || !isPostgresRecruitmentTarget()) return NextResponse.json({ ok: true, skipped: "not_postgres_target" });
  try {
    const result = await recoverStaleLiveInterviews({ limit: 10 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[Live Interview Recovery] Sweep failed:", error);
    return NextResponse.json({ ok: false, error: "recovery_failed" }, { status: 500 });
  }
}
