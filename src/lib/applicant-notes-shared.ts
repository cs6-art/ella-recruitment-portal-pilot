// Client-safe note rules (no database imports).

export const NOTE_MAX_LENGTH = 5000;

export type ApplicantNote = { id: string; body: string; authorName: string; authorEmail: string; createdAt: string; updatedAt: string; edited: boolean };

export function cleanNoteBody(value: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const body = typeof value === "string" ? value.trim() : "";
  if (!body) return { ok: false, error: "Write a note first." };
  if (body.length > NOTE_MAX_LENGTH) return { ok: false, error: `Notes can be up to ${NOTE_MAX_LENGTH} characters.` };
  return { ok: true, body };
}

/** The author, or an access administrator, may change a note. */
export function canChangeNote(user: { email: string; accessAdmin: boolean }, note: { authorEmail: string }) {
  return user.accessAdmin || (Boolean(note.authorEmail) && note.authorEmail.trim().toLowerCase() === user.email.trim().toLowerCase());
}
