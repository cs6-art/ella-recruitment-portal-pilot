import { NextResponse } from "next/server";

import { MAX_RECORDING_CHUNK_BYTES } from "@/lib/interview-recording-storage";
import { interviewErrorResponse } from "@/lib/live-interview-http";
import { receiveRecordingChunk } from "@/lib/live-interview-store";
import { consumeRateLimit } from "@/lib/rate-limit";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Receives one binary recording chunk. The invitation token travels in a
 * header because the body is raw video bytes.
 */
export async function POST(request: Request) {
  if (!isPostgresRecruitmentTarget()) return NextResponse.json({ success: false, error: "Not available." }, { status: 404 });
  const token = request.headers.get("x-avatar-token")?.trim() || "";
  const offset = Number(request.headers.get("x-recording-offset"));
  const final = request.headers.get("x-recording-final") === "1";
  const mimeType = request.headers.get("x-recording-mime-type")?.trim() || "";
  if (!token || token.length > 200) return NextResponse.json({ success: false, error: "The interview link is missing." }, { status: 400 });
  if (!consumeRateLimit(`live-interview:recording:${token}`, 600, 60 * 60 * 1000).allowed) return NextResponse.json({ success: false, error: "Too many recording uploads." }, { status: 429 });
  const declared = Number(request.headers.get("content-length") || "0");
  if (declared > MAX_RECORDING_CHUNK_BYTES) return NextResponse.json({ success: false, error: "Recording chunk too large." }, { status: 413 });
  try {
    const chunk = new Uint8Array(await request.arrayBuffer());
    if (chunk.byteLength > MAX_RECORDING_CHUNK_BYTES) return NextResponse.json({ success: false, error: "Recording chunk too large." }, { status: 413 });
    const result = await receiveRecordingChunk({ rawToken: token, offset, final, mimeType, chunk });
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return interviewErrorResponse("Recording", error);
  }
}
