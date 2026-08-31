import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canManagePipeline } from "@/lib/access-control";
import { getAuthorizedGraphToken, listMicrosoftDriveChildren } from "@/lib/microsoft-drive";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESUME_EXT = /\.(pdf|docx?|doc)$/i;

export async function GET(request: Request) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (!canManagePipeline(user)) return NextResponse.json({ success: false, error: "Only HR reviewers can browse OneDrive." }, { status: 403 });

  const rate = consumeRateLimit(`onedrive-list:${user.email}:${requestClientKey(request)}`, 120, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many OneDrive requests. Slow down." }, { status: 429, headers: rateLimitHeaders(rate) });

  const token = await getAuthorizedGraphToken(user.email);
  if (!token) return NextResponse.json({ success: false, error: "Connect OneDrive first (or reconnect if access was revoked).", code: "ONEDRIVE_NOT_CONNECTED" }, { status: 409 });

  const url = new URL(request.url);
  const folderId = (url.searchParams.get("folderId") || "root").trim() || "root";
  const pageUrl = url.searchParams.get("pageUrl") || undefined;

  try {
    const { items, nextPageUrl } = await listMicrosoftDriveChildren(token, folderId, pageUrl);
    const folders = items.filter((item) => item.isFolder).map((item) => ({ id: item.id, name: item.name }));
    const files = items
      .filter((item) => !item.isFolder && RESUME_EXT.test(item.name))
      .map((item) => ({ id: item.id, name: item.name, mimeType: item.mimeType, size: item.size, modifiedTime: item.lastModified }));

    // Breadcrumb: walk parentReference up (capped).
    const breadcrumb: Array<{ id: string; name: string }> = [{ id: "root", name: "OneDrive" }];
    if (folderId !== "root") {
      const chain: Array<{ id: string; name: string }> = [];
      let cursor: string | null = folderId;
      for (let depth = 0; depth < 12 && cursor && cursor !== "root"; depth += 1) {
        const { folder } = await listMicrosoftDriveChildren(token, cursor);
        if (!folder) break;
        chain.unshift({ id: folder.id, name: folder.name });
        cursor = folder.parentId;
      }
      breadcrumb.push(...chain);
    }

    return NextResponse.json({ success: true, folderId, folders, files, breadcrumb, nextPageToken: nextPageUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[OneDrive List] failed:", error);
    return NextResponse.json({ success: false, error: "Unable to read that OneDrive folder." }, { status: 502 });
  }
}
