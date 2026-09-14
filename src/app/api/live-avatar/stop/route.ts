import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const bridgeUrl = process.env.LIVEAVATAR_BRIDGE_URL?.trim().replace(/\/+$/, "");
  if (!bridgeUrl) return NextResponse.json({ success: true });
  let sessionId = "";
  try {
    const body = await request.json();
    sessionId = typeof body?.session_id === "string" ? body.session_id.trim() : "";
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }
  if (!sessionId) return NextResponse.json({ success: true });
  try {
    const response = await fetch(`${bridgeUrl}/api/session/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`bridge returned ${response.status}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API Live Avatar Stop] POST failed:", error);
    return NextResponse.json({ success: false, error: "Unable to stop the live avatar session." }, { status: 502 });
  }
}
