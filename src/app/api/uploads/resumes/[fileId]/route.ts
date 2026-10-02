import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";
import { getResumeFileRecord, readResumeFile, verifyResumeDownloadToken } from "@/lib/resume-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ fileId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { fileId } = await params;
  const record = await getResumeFileRecord(fileId);
  if (!record) return NextResponse.json({ success: false, error: "Resume file not found or expired." }, { status: 404 });

  const token = new URL(request.url).searchParams.get("token");
  const session = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  const authorizedHr = session?.canReviewRole === true || session?.canApproveRole === true;
  const authorizedWorkflow = token ? verifyResumeDownloadToken(token, fileId) : false;
  if (!authorizedHr && !authorizedWorkflow) return NextResponse.json({ success: false, error: "Resume file access is not authorized." }, { status: 403 });

  try {
    const content = await readResumeFile(record);
    return new NextResponse(content as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": record.mimeType,
        "Content-Length": String(content.length),
        "Content-Disposition": `attachment; filename="${record.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[Resume Download] GET failed:", error);
    return NextResponse.json({ success: false, error: "Resume file could not be read." }, { status: 404 });
  }
}
