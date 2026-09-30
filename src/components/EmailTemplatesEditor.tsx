"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { clientErrorMessage } from "@/lib/client-error";
import {
  emailSignoff,
  isValidImageUrl,
  MAX_BODY_LENGTH,
  MAX_BUTTON_LABEL_LENGTH,
  MAX_IMAGE_ALT_LENGTH,
  MAX_SUBJECT_LENGTH,
  PLACEHOLDER_HELP,
  PLACEHOLDER_LABEL,
  renderEventEmail,
  validateEmailTemplate,
  type EditableEmailEvent,
  type EmailPlaceholder,
} from "@/lib/email-templates";

type Template = {
  key: EditableEmailEvent;
  label: string;
  audience: string;
  when: string;
  placeholders: EmailPlaceholder[];
  buttons: { primary?: string; secondary?: string };
  subject: string;
  body: string;
  ctaLabel: string;
  secondaryCtaLabel: string;
  imageUrl: string;
  imageAlt: string;
  customized: boolean;
  updatedBy: string;
  updatedAt: string;
};

type Draft = { subject: string; body: string; ctaLabel: string; secondaryCtaLabel: string; imageUrl: string; imageAlt: string };
type Notice = { kind: "success" | "error"; text: string } | null;

const SAMPLE: Record<EmailPlaceholder, string> = {
  candidate_name: "Alex Tan",
  role_title: "Sales Manager",
  role_phrase: "the Sales Manager position",
  company_name: "Your Company",
  interview_time: "12 Oct 2026, 2:00 PM (Asia/Singapore)",
  ai_notice: "",
  recipient_name: "Jamie",
  role_id: "(RR-1024)",
  department: "in Sales",
  requested_by: "Jordan Lee",
};

function draftOf(template: Template): Draft {
  return { subject: template.subject, body: template.body, ctaLabel: template.ctaLabel, secondaryCtaLabel: template.secondaryCtaLabel, imageUrl: template.imageUrl, imageAlt: template.imageAlt };
}

function sameDraft(left: Draft, right: Draft) {
  return left.subject === right.subject && left.body === right.body && left.ctaLabel === right.ctaLabel && left.secondaryCtaLabel === right.secondaryCtaLabel && left.imageUrl === right.imageUrl && left.imageAlt === right.imageAlt;
}

/** Lets a settings administrator edit the wording, buttons and header image of the automated emails. */
export default function EmailTemplatesEditor() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedKey, setSelectedKey] = useState<EditableEmailEvent | "">("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [brokenImage, setBrokenImage] = useState("");
  const lastFocus = useRef<"subject" | "body">("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const selected = templates.find((template) => template.key === selectedKey) || null;
  const saved = selected ? draftOf(selected) : null;
  const draft = selected ? drafts[selected.key] || saved : null;
  const changed = Boolean(draft && saved && !sameDraft(draft, saved));

  function setDraft(patch: Partial<Draft>) {
    if (!selected || !draft) return;
    setDrafts((current) => ({ ...current, [selected.key]: { ...draft, ...patch } }));
    setNotice(null);
  }

  async function load(keepKey?: string) {
    const response = await fetch("/api/email-templates", { credentials: "same-origin", cache: "no-store" });
    const data = await response.json();
    if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to load the emails.");
    const list = data.templates as Template[];
    setTemplates(list);
    setDrafts({});
    const next = list.find((template) => template.key === keepKey) || list[0];
    if (next) setSelectedKey(next.key);
  }

  useEffect(() => {
    load().catch((caught) => setNotice({ kind: "error", text: clientErrorMessage(caught, "Unable to load the emails.") })).finally(() => setLoading(false));
  }, []);

  function insertPlaceholder(name: EmailPlaceholder) {
    if (!draft) return;
    const token = `{{${name}}}`;
    const field = lastFocus.current;
    const element = field === "subject" ? subjectRef.current : bodyRef.current;
    const value = field === "subject" ? draft.subject : draft.body;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    setDraft(field === "subject" ? { subject: next } : { body: next });
    window.requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const problem = useMemo(() => (selected && draft ? validateEmailTemplate(selected.key, draft.subject, draft.body, draft) : null), [selected, draft]);

  async function save() {
    if (!selected || !draft || problem) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/email-templates", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventType: selected.key, ...draft }) });
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
    if (!selected || !draft) return null;
    try {
      const values = Object.fromEntries(selected.placeholders.map((name) => [name, SAMPLE[name]])) as Partial<Record<EmailPlaceholder, string>>;
      return renderEventEmail(selected.key, values, { subject: draft.subject, body: draft.body });
    } catch {
      return null;
    }
  }, [selected, draft]);

  const imageUrl = draft?.imageUrl.trim() || "";
  const imageOk = Boolean(imageUrl) && isValidImageUrl(imageUrl);
  const primaryLabel = selected?.buttons.primary ? draft?.ctaLabel.trim() || selected.buttons.primary : "";
  const secondaryLabel = selected?.buttons.secondary ? draft?.secondaryCtaLabel.trim() || selected.buttons.secondary : "";

  return (
    <section id="automated-emails" className="card settings-section email-editor-section" aria-labelledby="email-templates-title">
      <div className="settings-section-header">
        <div>
          <h2 id="email-templates-title">Automated Emails</h2>
          <p>Change what candidates and your team read in the emails the portal sends: the subject, the message, the button text and a header image. Button links and the sign-off are added automatically.</p>
        </div>
      </div>
      {notice && <ActionFeedback kind={notice.kind}>{notice.text}</ActionFeedback>}
      {loading ? <div className="empty">Loading emails...</div> : !selected || !draft ? null : (
        <div className="email-editor">
          <nav className="email-editor-list" aria-label="Automated emails">
            {templates.map((template) => {
              const edited = template.customized || (drafts[template.key] && !sameDraft(drafts[template.key], draftOf(template)));
              return (
                <button key={template.key} type="button" className={`email-editor-item${template.key === selected.key ? " is-active" : ""}`} aria-current={template.key === selected.key} onClick={() => { setSelectedKey(template.key); setNotice(null); }}>
                  <span className="email-editor-item-title">{template.label}</span>
                  <span className="email-editor-item-meta">To: {template.audience}</span>
                  {edited && <span className="email-editor-badge">{drafts[template.key] && !sameDraft(drafts[template.key], draftOf(template)) ? "Unsaved" : "Edited"}</span>}
                </button>
              );
            })}
          </nav>

          <div className="email-editor-main">
            <div className="email-editor-intro">
              <h3>{selected.label}</h3>
              <p>{selected.when}</p>
            </div>
            <div className="email-editor-columns">
              <div className="email-editor-form">
                <div className="settings-field">
                  <div className="email-editor-label-row"><label htmlFor="email-template-subject">Subject</label><small>{draft.subject.length}/{MAX_SUBJECT_LENGTH}</small></div>
                  <input id="email-template-subject" ref={subjectRef} value={draft.subject} maxLength={MAX_SUBJECT_LENGTH} onFocus={() => { lastFocus.current = "subject"; }} onChange={(event) => setDraft({ subject: event.target.value })} />
                </div>

                <div className="settings-field">
                  <div className="email-editor-label-row"><label htmlFor="email-template-body">Message</label><small>{draft.body.length}/{MAX_BODY_LENGTH}</small></div>
                  <textarea id="email-template-body" ref={bodyRef} rows={12} value={draft.body} maxLength={MAX_BODY_LENGTH} onFocus={() => { lastFocus.current = "body"; }} onChange={(event) => setDraft({ body: event.target.value })} />
                  <div className="email-editor-chips" role="group" aria-label="Insert details">
                    <span>Insert:</span>
                    {selected.placeholders.map((name) => <button key={name} type="button" className="email-editor-chip" title={PLACEHOLDER_HELP[name]} onClick={() => insertPlaceholder(name)}>{PLACEHOLDER_LABEL[name]}</button>)}
                  </div>
                  <small>Click a detail to add it where your cursor is. It is filled in for each person when the email is sent. A line with a detail that is empty is left out.</small>
                </div>

                {(selected.buttons.primary || selected.buttons.secondary) && (
                  <fieldset className="email-editor-fieldset">
                    <legend>Buttons</legend>
                    {selected.buttons.primary && (
                      <div className="settings-field">
                        <label htmlFor="email-template-cta">Button text</label>
                        <input id="email-template-cta" value={draft.ctaLabel} maxLength={MAX_BUTTON_LABEL_LENGTH} placeholder={selected.buttons.primary} onChange={(event) => setDraft({ ctaLabel: event.target.value })} />
                      </div>
                    )}
                    {selected.buttons.secondary && (
                      <div className="settings-field">
                        <label htmlFor="email-template-cta2">Second button text</label>
                        <input id="email-template-cta2" value={draft.secondaryCtaLabel} maxLength={MAX_BUTTON_LABEL_LENGTH} placeholder={selected.buttons.secondary} onChange={(event) => setDraft({ secondaryCtaLabel: event.target.value })} />
                        <small>Only shown to candidates who can also interview with the Avatar.</small>
                      </div>
                    )}
                    <small>Leave a box empty to keep the standard text. Where each button leads is set by the portal and cannot be changed, so a link can never break.</small>
                  </fieldset>
                )}

                <fieldset className="email-editor-fieldset">
                  <legend>Header image (optional)</legend>
                  <div className="settings-field">
                    <label htmlFor="email-template-image">Image link</label>
                    <input id="email-template-image" type="url" inputMode="url" value={draft.imageUrl} maxLength={500} placeholder="https://example.com/logo.png" onChange={(event) => setDraft({ imageUrl: event.target.value })} />
                    <small>Paste a public link that starts with https:// and ends in .png, .jpg or .gif. About 600 pixels wide works best. The image is shown at the top of the email. It is not attached as a file, so it needs to stay online.</small>
                  </div>
                  <div className="settings-field">
                    <label htmlFor="email-template-alt">Image description</label>
                    <input id="email-template-alt" value={draft.imageAlt} maxLength={MAX_IMAGE_ALT_LENGTH} placeholder="Shown if the image cannot load" disabled={!imageUrl} onChange={(event) => setDraft({ imageAlt: event.target.value })} />
                  </div>
                </fieldset>

                {problem && changed && <ActionFeedback kind="error" dismissAfterMs={null}>{problem}</ActionFeedback>}

                <div className="settings-actions email-editor-actions">
                  <span>{changed ? "You have unsaved changes." : selected.customized ? `Edited${selected.updatedBy ? ` by ${selected.updatedBy}` : ""}. This email uses your wording.` : "This email uses the standard wording."}</span>
                  <span>
                    {selected.customized && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void reset()}>Restore Original</button>}{" "}
                    {changed && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setDrafts((current) => { const next = { ...current }; delete next[selected.key]; return next; })}>Discard Changes</button>}{" "}
                    <button type="button" className="btn btn-primary" disabled={busy || !changed || Boolean(problem)} onClick={() => void save()}>{busy ? "Saving…" : "Save Email"}</button>
                  </span>
                </div>
              </div>

              <aside className="email-editor-preview" aria-label="Preview">
                <h4>Preview</h4>
                <p className="email-editor-preview-note">Shown with sample details. Each recipient sees their own.</p>
                {preview && (
                  <div className="email-preview">
                    <div className="email-preview-meta"><span>Subject</span><strong>{preview.subject}</strong></div>
                    <div className="email-preview-body">
                      {imageOk && (brokenImage === imageUrl
                        ? <p className="email-preview-broken">The image could not be loaded from that link. Check it opens in a browser.</p>
                        // eslint-disable-next-line @next/next/no-img-element
                        : <img src={imageUrl} alt={draft.imageAlt} className="email-preview-image" onError={() => setBrokenImage(imageUrl)} />)}
                      {preview.body.split(/\n{2,}/).map((block, index) => <p key={index}>{block.split("\n").map((line, lineIndex, lines) => <span key={lineIndex}>{line}{lineIndex < lines.length - 1 && <br />}</span>)}</p>)}
                      {primaryLabel && <p><span className="email-preview-button">{primaryLabel}</span></p>}
                      {secondaryLabel && <p><span className="email-preview-button is-secondary">{secondaryLabel}</span></p>}
                      <p className="email-preview-signoff">{emailSignoff(SAMPLE.company_name).split("\n").map((line, index) => <span key={index}>{line}<br /></span>)}</p>
                    </div>
                  </div>
                )}
              </aside>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
