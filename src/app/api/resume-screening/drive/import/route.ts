import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { canManagePipeline } from "@/lib/access-control";
import { EllaCreditsError, intakeResumeBatch, MAX_FILES_PER_SUBMISSION } from "@/lib/bulk-resume-intake";
import { getAuthorizedDriveClient } from "@/lib/google-drive";
import { MAX_RESUME_FILE_BYTES } from "@/lib/resume-files";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { resolvePublishedRecruitmentRole } from "@/lib/recruitment-role-resolution";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESUME_EXT = /\.(pdf|docx?|doc)$/i;

const bodySchema = z.object({
  roleId: z.string().trim().min(1).max(200),
  fileIds: z.array(z.string().trim().min(1).max(200)).min(1).max(MAX_FILES_PER_SUBMISSION),
  files: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().max(200),
  })).max(MAX_FILES_PER_SUBMISSION).optional(),
});

function maskDriveId(value: string | null | undefined) {
  const id = (value || "").trim();
  return id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : "[short-id]";
}

function responseError(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

export async function POST(request: Request) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return responseError("Authentication required.", 401);
  if (!canManagePipeline(user)) return responseError("Only HR reviewers can import resumes from Google Drive.", 403);

  const rate = consumeRateLimit(`drive-import:${user.email}:${requestClientKey(request)}`, 5, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many imports. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return responseError(`Select 1 to ${MAX_FILES_PER_SUBMISSION} files and a published role.`, 422);
  const { roleId } = parsed.data;
  const fileIds = [...new Set(parsed.data.fileIds)];
  console.info("[Drive Import] request", { roleId, fileIds, fileCount: fileIds.length });
  const expectedFiles = new Map((parsed.data.files || []).map((file) => [file.id, file]));

  const role = await resolvePublishedRecruitmentRole(roleId);
  if (!role) return responseError("The selected role is not available for bulk screening.", 409);

  const drive = await getAuthorizedDriveClient(user.email);
  if (!drive) return responseError("Connect Google Drive first.", 409, { code: "DRIVE_NOT_CONNECTED" });

  try {
    // Metadata pass first: reject non-resume / oversized / Google-native files
    // without downloading them.
    const rejected: Array<Record<string, unknown>> = [];
    const valid: Array<{ id: string; name: string; mimeType: string }> = [];
    await Promise.all(fileIds.map(async (fileId) => {
      const expected = expectedFiles.get(fileId);
      try {
        const meta = await drive.files.get({ fileId, fields: "id, name, mimeType, size, driveId, parents, shortcutDetails(targetId, targetMimeType)", supportsAllDrives: true });
        const resolvedId = String(meta.data.id || "").trim();
        const name = meta.data.name || "file";
        const mimeType = meta.data.mimeType || "";
        const size = Number(meta.data.size || 0);
        const shortcutTargetId = meta.data.shortcutDetails?.targetId || "";
        console.info("[Drive Import] verified selection", {
          requestedId: maskDriveId(fileId),
          requestedName: expected?.name || "",
          requestedMimeType: expected?.mimeType || "",
          resolvedId: maskDriveId(resolvedId),
          resolvedName: name,
          resolvedMimeType: mimeType,
          driveId: maskDriveId(meta.data.driveId),
          parentIds: (meta.data.parents || []).map((parent) => maskDriveId(parent)),
          shortcutTargetId: maskDriveId(shortcutTargetId),
        });
        if (!resolvedId || resolvedId !== fileId) {
          rejected.push({ fileName: name, status: "Failed", error: "The selected Drive item could not be verified as a file." });
        } else if (shortcutTargetId) {
          rejected.push({ fileName: expected?.name || name, status: "Failed", error: "Select the target resume file, not a Drive shortcut." });
        } else if (mimeType === "application/vnd.google-apps.folder") {
          rejected.push({ fileName: expected?.name || name, status: "Failed", error: "Select a resume file, not a Drive folder or shared-drive root." });
        } else if (expected && (expected.name !== name || (expected.mimeType && expected.mimeType !== mimeType))) {
          rejected.push({ fileName: expected.name, status: "Failed", error: "The selected Drive file changed before import. Refresh the folder and select it again." });
        } else if (mimeType.startsWith("application/vnd.google-apps.")) {
          rejected.push({ fileName: name, status: "Failed", error: "Google Docs cannot be screened — export as PDF first." });
        } else if (!RESUME_EXT.test(name)) {
          rejected.push({ fileName: name, status: "Failed", error: "Only PDF, DOC, and DOCX resumes are supported." });
        } else if (size > MAX_RESUME_FILE_BYTES) {
          rejected.push({ fileName: name, status: "Failed", error: "Resume files must be 10 MB or smaller." });
        } else {
          valid.push({ id: fileId, name, mimeType });
        }
      } catch (error) {
        console.warn("[Drive Import] selection lookup failed", {
          requestedId: maskDriveId(fileId),
          requestedName: expected?.name || "",
          requestedMimeType: expected?.mimeType || "",
          status: (error as { response?: { status?: number }; code?: number })?.response?.status || (error as { code?: number })?.code || "unknown",
        });
        rejected.push({ fileName: expected?.name || "selected file", status: "Failed", error: "That selected Drive file is unavailable or no longer accessible." });
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
      sourceLabel: "Portal Drive Import",
      sources: valid.map((file) => ({
        name: file.name,
        mimeType: file.mimeType,
        driveFileId: file.id,
        getBytes: async () => {
          console.info("[Drive Import] source download", { fileId: file.id, fileName: file.name });
          const media = await drive.files.get(
            { fileId: file.id, alt: "media", supportsAllDrives: true },
            { responseType: "arraybuffer" },
          );
          return Buffer.from(media.data as ArrayBuffer);
        },
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
    console.error("[Drive Import] POST failed:", error);
    return responseError(error instanceof Error ? error.message : "Unable to import resumes from Google Drive.", 400);
  }
}
