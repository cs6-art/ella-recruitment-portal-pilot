import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { sampleResumeById } from "@/lib/sample-catalog";
import { renderSampleResumePdf } from "@/lib/sample-resume-pdf";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";

type Context = { params: Promise<{ sampleId: string }> };

/** Preview a built-in sample resume. Fictional content only; available to any signed-in user. */
export async function GET(_request: Request, context: Context) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return NextResponse.json({ success: false, error: "Please sign in." }, { status: 401 });
  const { sampleId } = await context.params;
  const resume = sampleResumeById(decodeURIComponent(sampleId));
  if (!resume) return NextResponse.json({ success: false, error: "Sample resume not found." }, { status: 404 });
  const bytes = renderSampleResumePdf(resume);
  return new NextResponse(Buffer.from(bytes) as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${resume.fileName}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
