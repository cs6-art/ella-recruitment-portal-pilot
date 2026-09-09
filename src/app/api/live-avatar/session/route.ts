import { NextRequest, NextResponse } from "next/server";
import { getRoleRequestById, isPublishedRoleForIntake } from "@/lib/google-sheets";
import { createLiveAvatarSession, isLiveAvatarConfigured } from "@/lib/live-avatar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, unauthenticated endpoint used by the "Meet Ella now" widget on the
// candidate apply page. It never accepts a job description or role title
// from the client — only a roleId — and re-loads that role from the
// spreadsheet itself, so a candidate cannot use this route to make Ella
// introduce a role that isn't actually published.
export async function POST(request: NextRequest) {
  if (!isLiveAvatarConfigured()) {
    return NextResponse.json(
      { success: false, error: "The live avatar interview is not configured yet." },
      { status: 503 },
    );
  }

  let roleId: unknown;
  let candidateName: unknown;
  try {
    const body = await request.json();
    roleId = body?.roleId;
    candidateName = body?.candidateName;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  if (typeof roleId !== "string" || !roleId.trim()) {
    return NextResponse.json({ success: false, error: "roleId is required." }, { status: 400 });
  }

  try {
    const role = await getRoleRequestById(roleId);
    if (!role || !isPublishedRoleForIntake(role)) {
      return NextResponse.json({ success: false, error: "This role is not currently accepting applications." }, { status: 404 });
    }

    const session = await createLiveAvatarSession({
      roleTitle: role.jobTitle,
      jobDescription: role.jobDescription || "",
      candidateName: typeof candidateName === "string" ? candidateName : undefined,
    });

    return NextResponse.json(
      { success: true, sessionToken: session.sessionToken, sessionId: session.sessionId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[API Live Avatar Session] POST failed:", error);
    return NextResponse.json({ success: false, error: "Unable to start the live avatar session." }, { status: 502 });
  }
}


