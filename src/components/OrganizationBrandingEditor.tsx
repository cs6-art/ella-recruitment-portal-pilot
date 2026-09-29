"use client";

import { useEffect, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { clientErrorMessage } from "@/lib/client-error";

type Branding = { name: string; subtitle: string };
const DEFAULT_BRANDING: Branding = { name: "McLink", subtitle: "Recruitment Portal" };

export default function OrganizationBrandingEditor() {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [savedBranding, setSavedBranding] = useState<Branding | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const hasChanges = savedBranding !== null &&
    (branding.name !== savedBranding.name || branding.subtitle !== savedBranding.subtitle);

  useEffect(() => {
    fetch("/api/organization/branding", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to load organization branding.");
        const loadedBranding: Branding = data.branding || DEFAULT_BRANDING;
        setBranding(loadedBranding);
        setSavedBranding(loadedBranding);
      })
      .catch((caught) => setError(clientErrorMessage(caught, "Unable to load organization branding.")))
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
      const persistedBranding: Branding = data.branding || branding;
      setBranding(persistedBranding);
      setSavedBranding(persistedBranding);
      setMessage(data.message || "Organization branding saved successfully.");
      window.dispatchEvent(new CustomEvent("portal-branding-updated"));
    } catch (caught) {
      setError(clientErrorMessage(caught, "Unable to save organization branding."));
    } finally {
      setSaving(false);
    }
  }

  return <main className="container page settings-page">
    <section className="card settings-section" aria-labelledby="organization-branding-title">
    <div className="settings-section-header"><div><h2 id="organization-branding-title">Organization Branding</h2><p>Choose the name and subtitle shown to signed-in users in this organization. This does not change internal tenant IDs or permissions.</p></div><span>2 settings</span></div>
    {loading && <div className="empty">Loading branding...</div>}
    {error && <ActionFeedback kind="error">{error}</ActionFeedback>}
    {message && <ActionFeedback kind="success">{message}</ActionFeedback>}
    {!loading && !error && <div className="settings-grid">
      <div className="settings-field"><div className="settings-field-heading"><label htmlFor="organization-display-name">Organization display name</label><span className="settings-runtime-status is-active">Active</span></div><input id="organization-display-name" value={branding.name} disabled={saving} onChange={(event) => setBranding((current) => ({ ...current, name: event.target.value }))} maxLength={80} /><small>Used in the signed-in portal header and navigation.</small></div>
      <div className="settings-field"><div className="settings-field-heading"><label htmlFor="organization-display-subtitle">Portal subtitle</label><span className="settings-runtime-status is-active">Active</span></div><input id="organization-display-subtitle" value={branding.subtitle} disabled={saving} onChange={(event) => setBranding((current) => ({ ...current, subtitle: event.target.value }))} maxLength={80} /><small>Short descriptor shown beside the organization name.</small></div>
      <div className="settings-actions organization-branding-actions"><span>Changes apply to this organization only.</span>{hasChanges && <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save branding"}</button>}</div>
    </div>}
    </section>
  </main>;
}
