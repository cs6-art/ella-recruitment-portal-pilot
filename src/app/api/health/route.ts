import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness check for an external uptime monitor. Public and data-free: only whether the app and its database respond. */
export async function GET() {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: true, database: "not_configured" }, { headers: { "Cache-Control": "no-store" } });
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ ok: true, database: "up" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[Health] Database check failed:", error);
    return NextResponse.json({ ok: false, database: "down" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
