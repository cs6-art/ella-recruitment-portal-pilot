import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { MAX_RESUME_FILE_BYTES, MAX_RESUME_REQUEST_BYTES, storeResumeFile } from "@/lib/resume-files";

export const runtime = "nodejs";

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: Request) {
  try {
    const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
    if (!user || user.canReviewRole !== true) return failure("Only HR reviewers can upload resume files.", 403);

    const rate = consumeRateLimit(`resume-upload:${user.email}:${requestClientKey(request)}`, 10, 15 * 60 * 1000);
    if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many resume uploads. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_RESUME_REQUEST_BYTES) return failure("Resume upload requests must be 10 MB or smaller.", 413);

    const formData = await request.formData();
    const value = formData.get("resumeFile");
    // Resume storage owns signature validation and extraction; this route only
    // enforces the authenticated upload boundary and request-size limit.
    if (!(value instanceof File)) return failure("Attach one PDF, DOC, or DOCX resume file.", 422);
    if (value.size > MAX_RESUME_FILE_BYTES) return failure("Resume files must be 10 MB or smaller.", 413);

    const stored = await storeResumeFile(value, { organizationId: user.organizationId });
    return NextResponse.json({
      success: true,
      file: {
        fileId: stored.record.fileId,
        fileName: stored.record.fileName,
        mimeType: stored.record.mimeType,
        size: stored.record.size,
        sha256: stored.record.sha256,
        expiresAt: stored.record.expiresAt,
      },
      extractedTextLength: stored.extractedText.length,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process the resume file.";
    console.error("[Resume Upload] POST failed:", message);
    return failure(message, 422);
  }
}
