import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrganizationRecordingDrive, saveOrganizationRecordingDrive } from "@/lib/organization-recording-drive";
import { validateRecordingDriveFolder } from "@/lib/recording-drive-oauth";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ folderId: z.string().trim().min(10).max(200) });

export async function PUT(request: Request) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (user.canEditSettings !== true) return NextResponse.json({ success: false, error: "Settings permission required." }, { status: 403 });
  const rate = consumeRateLimit(`recording-drive-folder:${user.organizationId}:${user.email}:${requestClientKey(request)}`, 20, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many folder changes. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  try {
    const input = schema.parse(await request.json());
    const config = await getOrganizationRecordingDrive(user.organizationId);
    if (!config?.googleAccountEmail) return NextResponse.json({ success: false, error: "Connect Google Drive before choosing a folder." }, { status: 409 });
    const folder = await validateRecordingDriveFolder(user.organizationId, config.googleAccountEmail, input.folderId);
    await saveOrganizationRecordingDrive({
      organizationId: user.organizationId,
      googleAccountEmail: config.googleAccountEmail,
      folderId: folder.id,
      folderName: folder.name,
      connectedByEmail: config.connectedByEmail,
      updatedByEmail: user.email,
    });
    return NextResponse.json({ success: true, folderName: folder.name, sharedDrive: Boolean(folder.driveId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ success: false, error: "Choose a valid Google Drive folder." }, { status: 400 });
    console.error("[Recording Drive] Folder validation failed:", error);
    const reason = error instanceof Error && /Choose a folder|cannot save recordings|Connect the organization's Google Drive/.test(error.message)
      ? error.message
      : "That folder could not be verified. Choose a folder the connected Google account can access and add files to.";
    return NextResponse.json({ success: false, error: reason }, { status: 422 });
  }
}
