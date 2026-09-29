"use client";

import { useEffect, useMemo, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { clientErrorMessage } from "@/lib/client-error";
import { emailSignoff, PLACEHOLDER_HELP, renderEventEmail, type EditableEmailEvent, type EmailPlaceholder } from "@/lib/email-templates";

type Template = {
  key: EditableEmailEvent;
  label: string;
  audience: string;
  when: string;
  placeholders: EmailPlaceholder[];
  defaultSubject: string;
  defaultBody: string;
  subject: string;
  body: string;
  customized: boolean;
};

type Notice = { kind: "success" | "error"; text: string } | null;

const SAMPLE: Record<EmailPlaceholder, string> = {
  candidate_name: "Alex Tan",
  role_title: "Sales Manager",
  role_phrase: "the Sales Manager position",
  company_name: "Your Company",
  interview_time: "2026-10-12 14:00 Asia/Singapore",
  ai_notice: "",
  recipient_name: "Jamie",
  role_id: "(RR-1024)",
  department: "in Sales",
  requested_by: "Jordan Lee",
};

/** Lets a settings administrator edit the subject and text of the automated emails. */
export default function EmailTemplatesEditor() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedKey, setSelectedKey] = useState<EditableEmailEvent | "">("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const selected = templates.find((template) => template.key === selectedKey) || null;

  function select(template: Template) {
    setSelectedKey(template.key);
    setSubject(template.subject);
    setBody(template.body);
    setNotice(null);
  }

  async function load(keepKey?: string) {
    const response = await fetch("/api/email-templates", { credentials: "same-origin", cache: "no-store" });
    const data = await response.json();
    if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to load the emails.");
    const list = data.templates as Template[];
    setTemplates(list);
    const next = list.find((template) => template.key === keepKey) || list[0];
    if (next) { setSelectedKey(next.key); setSubject(next.subject); setBody(next.body); }
  }

  useEffect(() => {
    load().catch((caught) => setNotice({ kind: "error", text: clientErrorMessage(caught, "Unable to load the emails.") })).finally(() => setLoading(false));
  }, []);

  async function save() {
    if (!selected) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/email-templates", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventType: selected.key, subject, body }) });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to save the email.");
      await load(selected.key);
      setNotice({ kind: "success", text: data.message || "Email saved." });
    } catch (caught) {
      setNotice({ kind: "error", text: clientErrorMessage(caught, "Unable to save the email.") });
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!selected) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/email-templates?eventType=${encodeURIComponent(selected.key)}`, { method: "DELETE", credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to restore the email.");
      await load(selected.key);
      setNotice({ kind: "success", text: data.message || "The original wording was restored." });
    } catch (caught) {
      setNotice({ kind: "error", text: clientErrorMessage(caught, "Unable to restore the email.") });
    } finally {
      setBusy(false);
    }
  }

  const preview = useMemo(() => {
    if (!selected) return null;
    try {
      const values = Object.fromEntries(selected.placeholders.map((name) => [name, SAMPLE[name]])) as Partial<Record<EmailPlaceholder, string>>;
      return renderEventEmail(selected.key, values, { subject, body });
    } catch {
      return null;
    }
  }, [selected, subject, body]);

  const changed = selected ? subject !== selected.subject || body !== selected.body : false;

  return (
    <section className="card settings-section" aria-labelledby="email-templates-title">
      <div className="settings-section-header"><div><h2 id="email-templates-title">Automated Emails</h2><p>Edit the subject and text of the emails the portal sends. Buttons, links and the sign-off are added automatically and cannot be removed.</p></div></div>
      {notice && <ActionFeedback kind={notice.kind}>{notice.text}</ActionFeedback>}
      {loading ? <div className="empty">Loading emails...</div> : !selected ? null : (
        <div className="settings-grid">
          <div className="settings-field">
            <label htmlFor="email-template-select">Email</label>
            <select id="email-template-select" value={selected.key} onChange={(event) => { const next = templates.find((template) => template.key === event.target.value); if (next) select(next); }}>
              {templates.map((template) => <option key={template.key} value={template.key}>{template.label}{template.customized ? " (edited)" : ""}</option>)}
            </select>
            <small>{selected.when} Sent to: {selected.audience.toLowerCase()}.</small>
          </div>
          <div className="settings-field">
            <label htmlFor="email-template-subject">Subject</label>
            <input id="email-template-subject" value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} />
          </div>
          <div className="settings-field">
            <label htmlFor="email-template-body">Email text</label>
            <textarea id="email-template-body" rows={14} value={body} maxLength={5000} onChange={(event) => setBody(event.target.value)} />
            <small>Available placeholders: {selected.placeholders.map((name) => `{{${name}}}`).join(", ")}. A line whose placeholders are all empty is left out.</small>
            <details><summary>What each placeholder shows</summary><ul>{selected.placeholders.map((name) => <li key={name}><code>{`{{${name}}}`}</code>: {PLACEHOLDER_HELP[name]}</li>)}</ul></details>
          </div>
          {preview && (
            <div className="settings-field">
              <label>Preview With Sample Details</label>
              <div className="email-preview"><strong>{preview.subject}</strong><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: "8px 0 0" }}>{preview.body}</pre><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: "12px 0 0", opacity: 0.75 }}>{emailSignoff(SAMPLE.company_name)}</pre></div>
            </div>
          )}
          <div className="settings-actions">
            <span>{selected.customized ? "This email uses your wording." : "This email uses the standard wording."}</span>
            <span>
              {selected.customized && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void reset()}>Restore Original</button>}{" "}
              <button type="button" className="btn btn-primary" disabled={busy || !changed} onClick={() => void save()}>{busy ? "Saving…" : "Save Email"}</button>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
