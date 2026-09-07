import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { canManagePipeline } from "@/lib/access-control";
import { EllaCreditsError, intakeResumeBatch, MAX_FILES_PER_SUBMISSION } from "@/lib/bulk-resume-intake";
import { downloadMicrosoftDriveFile, getAuthorizedGraphToken, getMicrosoftDriveItem } from "@/lib/microsoft-drive";
import { MAX_RESUME_FILE_BYTES } from "@/lib/resume-files";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { resolvePublishedRecruitmentRole } from "@/lib/recruitment-role-resolution";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESUME_EXT = /\.(pdf|docx?|doc)$/i;

const bodySchema = z.object({
  roleId: z.string().trim().min(1).max(200),
  fileIds: z.array(z.string().trim().min(1).max(400)).min(1).max(MAX_FILES_PER_SUBMISSION),
});

function responseError(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

export async function POST(request: Request) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return responseError("Authentication required.", 401);
  if (!canManagePipeline(user)) return responseError("Only HR reviewers can import resumes from OneDrive.", 403);

  const rate = consumeRateLimit(`onedrive-import:${user.email}:${requestClientKey(request)}`, 5, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many imports. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return responseError(`Select 1 to ${MAX_FILES_PER_SUBMISSION} files and a published role.`, 422);
  const { roleId } = parsed.data;
  const fileIds = [...new Set(parsed.data.fileIds)];

  const role = await resolvePublishedRecruitmentRole(roleId);
  if (!role) return responseError("The selected role is not available for bulk screening.", 409);

  const token = await getAuthorizedGraphToken(user.email);
  if (!token) return responseError("Connect OneDrive first (or reconnect if Microsoft access was revoked or expired).", 409, { code: "ONEDRIVE_NOT_CONNECTED" });

  try {
    // Metadata pass first: reject non-resume / oversized / unreadable files
    // (deleted, permission-revoked) without downloading them.
    const rejected: Array<Record<string, unknown>> = [];
    const valid: Array<{ id: string; name: string; mimeType: string }> = [];
    await Promise.all(fileIds.map(async (fileId) => {
      try {
        const item = await getMicrosoftDriveItem(token, fileId);
        if (item.isFolder) {
          rejected.push({ fileName: item.name || fileId, status: "Failed", error: "Folders cannot be screened — pick the files inside." });
        } else if (!RESUME_EXT.test(item.name)) {
          rejected.push({ fileName: item.name, status: "Failed", error: "Only PDF, DOC, and DOCX resumes are supported." });
        } else if (item.size > MAX_RESUME_FILE_BYTES) {
          rejected.push({ fileName: item.name, status: "Failed", error: "Resume files must be 10 MB or smaller." });
        } else {
          valid.push({ id: fileId, name: item.name, mimeType: item.mimeType });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const reason = /Graph 40[13]/.test(message)
          ? "Access to that OneDrive file was denied or revoked."
          : /Graph 404/.test(message)
            ? "That OneDrive file is no longer available."
            : "That file could not be read from OneDrive.";
        rejected.push({ fileName: fileId, status: "Failed", error: reason });
      }
    }));

    if (valid.length === 0) {
      return NextResponse.json({ success: true, roleId, results: rejected, batchId: "", submitted: 0, creditsCharged: 0, notificationStatus: "not_requested", concurrency: 0, environment: "production", isUat: false }, { status: 202 });
    }

    const intake = await intakeResumeBatch({
      roleId,
      roleTitle: role.jobTitle || "",
      actorName: user.name,
      actorEmail: user.email,
      submittedByEmail: user.email,
      sourceLabel: "Portal OneDrive Import",
      sources: valid.map((file) => ({
        name: file.name,
        mimeType: file.mimeType,
        driveFileId: file.id,
        getBytes: () => downloadMicrosoftDriveFile(token, file.id),
      })),
    });

    return NextResponse.json({ success: true, roleId, ...intake, results: [...intake.results, ...rejected] }, { status: 202 });
  } catch (error) {
    if (error instanceof EllaCreditsError) {
      return responseError("Not enough Ella Credits to screen this batch. Top up Ella Credits to continue.", 402, {
        code: error.code,
        required: error.required,
        available: error.available,
      });
    }
    console.error("[OneDrive Import] POST failed:", error);
    return responseError(error instanceof Error ? error.message : "Unable to import resumes from OneDrive.", 400);
  }
}
