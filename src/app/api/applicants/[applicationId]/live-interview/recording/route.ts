import { NextResponse } from "next/server";

import { fetchInterviewRecording } from "@/lib/interview-recording-storage";
import { authorizeInterviewReviewer } from "@/lib/live-interview-access";
import { getLiveInterviewRecordingRef } from "@/lib/live-interview-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ applicationId: string }> };

/**
 * Authenticated, organization-scoped playback. The Drive file is never
 * public; this route proxies it (with Range support for seeking).
 */
export async function GET(request: Request, context: RouteContext) {
  const applicationId = decodeURIComponent((await context.params).applicationId);
  const access = await authorizeInterviewReviewer(applicationId);
  if ("response" in access) return access.response;
  try {
    const ref = await getLiveInterviewRecordingRef(applicationId, access.user.organizationId);
    if (!ref) return NextResponse.json({ success: false, error: "No recording is available for this interview." }, { status: 404 });
    const upstream = await fetchInterviewRecording(ref.fileId, request.headers.get("range"));
    if (!upstream.ok || !upstream.body) {
      console.error("[API Live Interview Recording] Drive fetch failed:", { status: upstream.status });
      return NextResponse.json({ success: false, error: "The recording could not be loaded." }, { status: upstream.status === 416 ? 416 : 502 });
    }
    const headers = new Headers({
      "Content-Type": ref.mimeType,
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "bytes",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    });
    for (const name of ["content-length", "content-range"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    console.error("[API Live Interview Recording] GET failed:", error);
    return NextResponse.json({ success: false, error: "The recording could not be loaded." }, { status: 500 });
  }
}
