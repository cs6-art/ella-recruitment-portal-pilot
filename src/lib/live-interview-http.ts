import { NextResponse } from "next/server";

import { consumeRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { LiveInterviewError } from "@/lib/live-interview-store";

const NO_STORE = { "Cache-Control": "no-store" };

/** Shared guards for the token-authorised candidate interview endpoints. */
export async function readInterviewRequest(request: Request, options: { rateLimit: number; bucket: string }) {
  if (!isPostgresRecruitmentTarget()) return { error: NextResponse.json({ success: false, error: "This interview link is not available." }, { status: 404, headers: NO_STORE }) } as const;
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return { error: NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400, headers: NO_STORE }) } as const;
  }
  const token = typeof body?.avatarToken === "string" ? body.avatarToken.trim() : "";
  if (!token || token.length > 200) return { error: NextResponse.json({ success: false, error: "The interview link is missing." }, { status: 400, headers: NO_STORE }) } as const;
  // Keyed by invitation, not IP, so a shared office network is not throttled together.
  const limit = consumeRateLimit(`live-interview:${options.bucket}:${token}`, options.rateLimit, 10 * 60 * 1000);
  if (!limit.allowed) return { error: NextResponse.json({ success: false, error: "Too many requests. Please wait a moment." }, { status: 429, headers: { ...NO_STORE, ...rateLimitHeaders(limit) } }) } as const;
  return { body, token } as const;
}

export function interviewJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Client-safe message; the real error is logged server-side. */
export function interviewErrorResponse(scope: string, error: unknown) {
  if (error instanceof LiveInterviewError) return interviewJson({ success: false, error: error.message, code: error.code }, error.status);
  console.error(`[API Live Interview ${scope}] failed:`, error);
  return interviewJson({ success: false, error: "Something went wrong while saving your interview. Please try again." }, 500);
}
