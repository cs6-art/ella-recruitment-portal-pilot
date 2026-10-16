"use client";

import { useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { useConfirmation } from "@/components/ConfirmationModal";
import UiIcon from "@/components/UiIcon";
import { NOTE_MAX_LENGTH, type ApplicantNote } from "@/lib/applicant-notes-shared";
import { clientErrorMessage } from "@/lib/client-error";
import { formatPortalDateTime } from "@/lib/portal-time";

// HR-only notes: saved on their own, with no approve/reject/send step.
export default function ApplicantNotes({ applicationId, initialNotes, available, currentEmail, isAdmin }: { applicationId: string; initialNotes: ApplicantNote[]; available: boolean; currentEmail: string; isAdmin: boolean }) {
  const { confirm } = useConfirmation();
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/applicants/${encodeURIComponent(applicationId)}/notes`;
  const canChange = (note: ApplicantNote) => isAdmin || note.authorEmail.toLowerCase() === currentEmail.toLowerCase();

  async function send(url: string, method: string, body?: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify({ body }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || "Unable to save the note.");
      return data as { note?: ApplicantNote };
    } catch (caught) {
      setError(clientErrorMessage(caught, "Unable to save the note."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const data = await send(base, "POST", draft);
    if (data?.note) { setNotes((current) => [data.note!, ...current]); setDraft(""); }
  }

  async function saveEdit(id: string) {
    const data = await send(`${base}/${id}`, "PATCH", editDraft);
    if (data?.note) { setNotes((current) => current.map((note) => note.id === id ? data.note! : note)); setEditingId(""); }
  }

  async function remove(id: string) {
    if (!(await confirm({ title: "Delete note?", message: "This note will be removed for your whole HR team.", confirmLabel: "Delete", tone: "danger" }))) return;
    if (await send(`${base}/${id}`, "DELETE")) setNotes((current) => current.filter((note) => note.id !== id));
  }

  return <section className="card applicant-detail-card applicant-notes-card" id="hr-notes">
    <div className="card-header applicant-section-header"><div className="applicant-section-heading"><span className="applicant-section-icon"><UiIcon name="document" size={17} /></span><div><h2>HR Notes{notes.length > 0 && <small> ({notes.length})</small>}</h2><p>Private notes for your HR team. Saved on their own, with no decision needed. Candidates never see them.</p></div></div></div>
    {!available ? <p className="applicant-notes-empty">Notes are not available right now.</p> : <>
      <label className="field" htmlFor="applicant-note-draft"><span>Add a note <small>({draft.length}/{NOTE_MAX_LENGTH})</small></span><textarea id="applicant-note-draft" value={draft} maxLength={NOTE_MAX_LENGTH} disabled={busy} placeholder="e.g. Phone screen went well, expects a notice period of 1 month." onChange={(event) => { setDraft(event.target.value); setError(""); }} /></label>
      <div className="applicant-notes-actions"><button type="button" className="btn btn-primary" disabled={busy || !draft.trim()} onClick={() => void add()}>{busy && !editingId ? "Saving…" : "Add note"}</button></div>
      {error && <ActionFeedback kind="error">{error}</ActionFeedback>}
      {notes.length === 0 ? <p className="applicant-notes-empty">No notes yet. Notes are visible only to your HR team.</p> : <ul className="applicant-notes-list">{notes.map((note) => <li key={note.id} className="applicant-note">
        <div className="applicant-note-meta"><strong>{note.authorName || note.authorEmail || "HR"}</strong><span title={formatPortalDateTime(note.createdAt)}>{formatPortalDateTime(note.createdAt)}</span>{note.edited && <em>edited</em>}</div>
        {editingId === note.id ? <><textarea aria-label="Edit note" value={editDraft} maxLength={NOTE_MAX_LENGTH} disabled={busy} onChange={(event) => setEditDraft(event.target.value)} /><div className="applicant-notes-actions"><button type="button" className="btn btn-primary" disabled={busy || !editDraft.trim()} onClick={() => void saveEdit(note.id)}>Save</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setEditingId("")}>Cancel</button></div></>
          : <><p className="applicant-note-body">{note.body}</p>{canChange(note) && <div className="applicant-notes-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setEditingId(note.id); setEditDraft(note.body); setError(""); }}>Edit</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void remove(note.id)}>Delete</button></div>}</>}
      </li>)}</ul>}
    </>}
  </section>;
}
