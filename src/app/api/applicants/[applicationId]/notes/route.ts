import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canDecideApplicant } from "@/lib/access-control";
import { addApplicantNote, cleanNoteBody, listApplicantNotes } from "@/lib/applicant-notes";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

const unavailable = () => NextResponse.json({ error: "Notes need the database backend." }, { status: 501 });

export async function GET(_request: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user || !canDecideApplicant(user)) return NextResponse.json({ error: "You are not authorized to view notes." }, { status: 403 });
  if (!isPostgresRecruitmentTarget()) return unavailable();
  try {
    const notes = await listApplicantNotes(decodeURIComponent((await params).applicationId), user.organizationId);
    if (!notes) return NextResponse.json({ error: "Applicant not found." }, { status: 404 });
    return NextResponse.json({ success: true, notes });
  } catch {
    return NextResponse.json({ error: "Unable to load notes. Please try again." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user || !canDecideApplicant(user)) return NextResponse.json({ error: "You are not authorized to add notes." }, { status: 403 });
  if (!isPostgresRecruitmentTarget()) return unavailable();
  const rate = consumeRateLimit(`applicant-note:${user.email}:${requestClientKey(request)}`, 60, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many notes. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });
  try {
    const payload = await request.json().catch(() => ({})) as { body?: unknown };
    const clean = cleanNoteBody(payload.body);
    if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 422 });
    const note = await addApplicantNote(decodeURIComponent((await params).applicationId), user.organizationId, { name: user.name, email: user.email }, clean.body);
    if (!note) return NextResponse.json({ error: "Applicant not found." }, { status: 404 });
    return NextResponse.json({ success: true, note }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to save the note. Please try again." }, { status: 500 });
  }
}
