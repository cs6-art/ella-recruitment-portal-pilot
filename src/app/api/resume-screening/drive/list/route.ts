import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canManagePipeline } from "@/lib/access-control";
import { getAuthorizedDriveClient } from "@/lib/google-drive";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const RESUME_EXT = /\.(pdf|docx?|doc)$/i;

function escapeForQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function maskDriveId(value: string | null | undefined) {
  const id = (value || "").trim();
  return id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id || "[missing]";
}

export async function GET(request: Request) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (!canManagePipeline(user)) return NextResponse.json({ success: false, error: "Only HR reviewers can browse Google Drive." }, { status: 403 });

  const rate = consumeRateLimit(`drive-list:${user.email}:${requestClientKey(request)}`, 120, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many Drive requests. Slow down." }, { status: 429, headers: rateLimitHeaders(rate) });

  const drive = await getAuthorizedDriveClient(user.email);
  if (!drive) return NextResponse.json({ success: false, error: "Connect Google Drive first.", code: "DRIVE_NOT_CONNECTED" }, { status: 409 });

  const url = new URL(request.url);
  const folderId = (url.searchParams.get("folderId") || "root").trim() || "root";
  const pageToken = url.searchParams.get("pageToken") || undefined;
  const nameFilter = (url.searchParams.get("q") || "").trim().slice(0, 200);

  try {
    const parts = [`'${escapeForQuery(folderId)}' in parents`, "trashed = false"];
    parts.push(`(mimeType = '${FOLDER_MIME}' or name contains '.pdf' or name contains '.doc')`);
    if (nameFilter) parts.push(`name contains '${escapeForQuery(nameFilter)}'`);

    const list = await drive.files.list({
      q: parts.join(" and "),
      fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, driveId, parents, shortcutDetails(targetId, targetMimeType))",
      pageSize: 100,
      orderBy: "folder,name_natural",
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      corpora: "allDrives",
    });

    const all = list.data.files ?? [];
    const folders = all
      .filter((file) => file.mimeType === FOLDER_MIME)
      .map((file) => ({ id: file.id || "", name: file.name || "Untitled folder" }));
    const files = all
      .map((file) => {
        const targetId = file.shortcutDetails?.targetId?.trim();
        const targetMimeType = file.shortcutDetails?.targetMimeType?.trim();
        const id = targetId || file.id || "";
        const mimeType = targetMimeType || file.mimeType || "";
        const name = file.name || "Untitled";
        console.info("[Drive List] selection candidate", {
          name,
          listedId: maskDriveId(file.id),
          selectedId: maskDriveId(id),
          mimeType,
          driveId: maskDriveId(file.driveId),
          parentIds: (file.parents || []).map((parent) => maskDriveId(parent)),
          shortcutTargetId: maskDriveId(targetId),
        });
        if (!id || id === "root" || mimeType === FOLDER_MIME || mimeType.startsWith("application/vnd.google-apps.") || !RESUME_EXT.test(name)) return null;
        return {
          id,
          name,
          mimeType,
          size: Number(file.size || 0),
          modifiedTime: file.modifiedTime || "",
        };
      })
      .filter((file): file is { id: string; name: string; mimeType: string; size: number; modifiedTime: string } => Boolean(file));

    // Breadcrumb: walk up to My Drive (capped).
    const breadcrumb: Array<{ id: string; name: string }> = [{ id: "root", name: "My Drive" }];
    if (folderId !== "root") {
      const chain: Array<{ id: string; name: string }> = [];
      let cursor: string | undefined | null = folderId;
      for (let depth = 0; depth < 12 && cursor && cursor !== "root"; depth += 1) {
        const meta = await drive.files.get({ fileId: cursor, fields: "id, name, parents", supportsAllDrives: true });
        const data: { id?: string | null; name?: string | null; parents?: string[] | null } = meta.data;
        chain.unshift({ id: data.id || cursor, name: data.name || "Folder" });
        cursor = data.parents?.[0] ?? null;
      }
      breadcrumb.push(...chain);
    }

    return NextResponse.json({ success: true, folderId, folders, files, breadcrumb, nextPageToken: list.data.nextPageToken || null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[Drive List] failed:", error);
    return NextResponse.json({ success: false, error: "Unable to read that Google Drive folder." }, { status: 502 });
  }
}
