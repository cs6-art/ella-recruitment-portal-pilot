"use client";

import { useEffect, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";

type Branding = { name: string; subtitle: string };

export default function OrganizationBrandingEditor() {
  const [branding, setBranding] = useState<Branding>({ name: "McPrint", subtitle: "Recruitment Portal" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/organization/branding", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to load organization branding.");
        if (data.branding) setBranding(data.branding);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load organization branding."))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/organization/branding", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(branding) });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to save organization branding.");
      if (data.branding) setBranding(data.branding);
      setMessage(data.message || "Organization branding saved successfully.");
      window.dispatchEvent(new CustomEvent("portal-branding-updated"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save organization branding.");
    } finally {
      setSaving(false);
    }
  }

  return <main className="container page settings-page">
    <section className="card settings-section" aria-labelledby="organization-branding-title">
    <div className="settings-section-header"><div><h2 id="organization-branding-title">Organization branding</h2><p>Choose the name and subtitle shown to signed-in users in this organization. This does not change internal tenant IDs or permissions.</p></div><span>2 settings</span></div>
    {loading && <div className="empty">Loading branding...</div>}
    {error && <ActionFeedback kind="error">{error}</ActionFeedback>}
    {message && <ActionFeedback kind="success">{message}</ActionFeedback>}
    {!loading && !error && <div className="settings-grid">
      <div className="settings-field"><div className="settings-field-heading"><label htmlFor="organization-display-name">Organization display name</label><span className="settings-runtime-status is-active">Active</span></div><input id="organization-display-name" value={branding.name} onChange={(event) => setBranding((current) => ({ ...current, name: event.target.value }))} maxLength={80} /><small>Used in the signed-in portal header and navigation.</small></div>
      <div className="settings-field"><div className="settings-field-heading"><label htmlFor="organization-display-subtitle">Portal subtitle</label><span className="settings-runtime-status is-active">Active</span></div><input id="organization-display-subtitle" value={branding.subtitle} onChange={(event) => setBranding((current) => ({ ...current, subtitle: event.target.value }))} maxLength={80} /><small>Short descriptor shown beside the organization name.</small></div>
      <div className="settings-actions"><span>Changes apply to this organization only.</span><button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save branding"}</button></div>
    </div>}
    </section>
  </main>;
}
