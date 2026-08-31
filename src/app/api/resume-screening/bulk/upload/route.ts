import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canManagePipeline } from "@/lib/access-control";
import { EllaCreditsError } from "@/lib/ella-credits";
import { intakeResumeBatch, MAX_BULK_REQUEST_BYTES, MAX_FILES_PER_SUBMISSION } from "@/lib/bulk-resume-intake";
import { getRoleRequestById, isPublishedRoleForIntake } from "@/lib/google-sheets";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseError(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

export async function POST(request: Request) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return responseError("Authentication required.", 401);
  if (!canManagePipeline(user)) return responseError("Only HR reviewers can upload bulk resumes.", 403);

  const rate = consumeRateLimit(`bulk-resume-upload:${user.email}:${requestClientKey(request)}`, 5, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many bulk uploads. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BULK_REQUEST_BYTES) return responseError("Bulk uploads must be 100 MB or smaller per batch.", 413);

  try {
    const formData = await request.formData();
    const roleId = String(formData.get("roleId") || "").trim();
    const files = formData.getAll("resumes").filter((value): value is File => value instanceof File);
    if (!roleId) return responseError("Select a published role before uploading resumes.", 422);
    if (!files.length) return responseError("Choose at least one PDF, DOC, or DOCX resume.", 422);
    if (files.length > MAX_FILES_PER_SUBMISSION) return responseError(`Upload up to ${MAX_FILES_PER_SUBMISSION} resumes per batch.`, 422);

    const role = await getRoleRequestById(roleId);
    if (!role || !isPublishedRoleForIntake(role)) return responseError("The selected role is not available for bulk screening.", 409);

    const intake = await intakeResumeBatch({
      roleId,
      roleTitle: role.jobTitle || "",
      actorName: user.name,
      actorEmail: user.email,
      submittedByEmail: user.email,
      sourceLabel: "Portal Bulk Upload",
      uatRecoveryToken: String(formData.get("uatRecovery") || "").trim(),
      sources: files.map((file) => ({
        name: file.name,
        mimeType: file.type,
        getBytes: () => file.arrayBuffer().then((buffer) => Buffer.from(buffer)),
      })),
    });

    return NextResponse.json({ success: true, roleId, ...intake }, { status: 202 });
  } catch (error) {
    if (error instanceof EllaCreditsError) {
      return responseError("Not enough Ella Credits to screen this batch. Top up Ella Credits to continue.", 402, {
        code: error.code,
        required: error.required,
        available: error.available,
      });
    }
    console.error("[Bulk Resume Upload] POST failed:", error);
    return responseError(error instanceof Error ? error.message : "Unable to upload bulk resumes.", 400);
  }
}
