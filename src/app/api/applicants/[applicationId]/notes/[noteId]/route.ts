import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canAdministerAccess, canDecideApplicant } from "@/lib/access-control";
import { canChangeNote, cleanNoteBody, deleteApplicantNote, getApplicantNote, updateApplicantNote } from "@/lib/applicant-notes";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

type Ctx = { params: Promise<{ applicationId: string; noteId: string }> };

async function authorize(request: Request, { params }: Ctx) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user || !canDecideApplicant(user)) return { error: NextResponse.json({ error: "You are not authorized to change notes." }, { status: 403 }) };
  if (!isPostgresRecruitmentTarget()) return { error: NextResponse.json({ error: "Notes need the database backend." }, { status: 501 }) };
  const rate = consumeRateLimit(`applicant-note:${user.email}:${requestClientKey(request)}`, 60, 15 * 60 * 1000);
  if (!rate.allowed) return { error: NextResponse.json({ error: "Too many changes. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) }) };
  const { applicationId, noteId } = await params;
  const id = decodeURIComponent(applicationId);
  const note = await getApplicantNote(id, user.organizationId, noteId);
  if (!note) return { error: NextResponse.json({ error: "Note not found." }, { status: 404 }) };
  if (!canChangeNote({ email: user.email, accessAdmin: canAdministerAccess(user) }, note)) return { error: NextResponse.json({ error: "Only the author or an HR administrator can change this note." }, { status: 403 }) };
  return { user, id, noteId };
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const auth = await authorize(request, ctx);
    if (auth.error) return auth.error;
    const payload = await request.json().catch(() => ({})) as { body?: unknown };
    const clean = cleanNoteBody(payload.body);
    if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 422 });
    const note = await updateApplicantNote(auth.id, auth.user.organizationId, auth.noteId, clean.body);
    if (!note) return NextResponse.json({ error: "Note not found." }, { status: 404 });
    return NextResponse.json({ success: true, note });
  } catch {
    return NextResponse.json({ error: "Unable to update the note. Please try again." }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const auth = await authorize(request, ctx);
    if (auth.error) return auth.error;
    if (!(await deleteApplicantNote(auth.id, auth.user.organizationId, auth.noteId))) return NextResponse.json({ error: "Note not found." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unable to delete the note. Please try again." }, { status: 500 });
  }
}
