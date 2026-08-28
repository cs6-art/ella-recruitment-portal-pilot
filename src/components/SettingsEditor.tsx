"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import ActionFeedback from "@/components/ActionFeedback";
import ValidationSummary from "@/components/ValidationSummary";

type Setting = {
  key: string;
  value: string;
  category: string;
  description: string;
  updatedAt: string;
  updatedBy: string;
  connectionStatus?: "active" | "stored";
  type?: "text" | "url" | "number" | "choice";
};

const categories = ["Access & Security", "Booking & Interview", "Workflow Rules", "Notifications", "Ella Credits"];
const categoryDescriptions: Record<string, string> = {
  "Access & Security": "Live access controls for the connected recruitment portal.",
  "Booking & Interview": "Defaults for the calendar and candidate booking links.",
  "Workflow Rules": "Live limits and timing rules used by recruitment automation.",
  Notifications: "Live notification behaviour for recruitment operations.",
  "Ella Credits": "Published pricing is fixed at 1 credit per CV analysis and 10 credits per AI phone interview. The balance is managed in the Ella Credits panel below.",
};

function labelFor(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isChoice(setting: Setting) {
  if (setting.type) return setting.type === "choice";
  return setting.value === "Yes" || setting.value === "No";
}

export default function SettingsEditor() {
  const router = useRouter();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/settings", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to load settings.");
        setSettings((data.settings || []).filter((setting: Setting) => categories.includes(setting.category) && setting.connectionStatus === "active"));
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load settings."))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    return categories.map((category) => ({ category, items: settings.filter((setting) => setting.category === category) }));
  }, [settings]);

  function update(key: string, value: string) {
    setSettings((current) => current.map((setting) => setting.key === key ? { ...setting, value } : setting));
    setSaveError("");
  }

  async function save() {
    setSaving(true);
    setError("");
    setSaveError("");
    setMessage("");
    try {
      const response = await fetch("/api/settings", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings }) });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to save settings.");
      setMessage(data.message || "Settings saved successfully.");
      router.refresh();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Unable to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="container page settings-page">
      <header className="hero-row settings-header">
        <div><span className="eyebrow-dark">PORTAL CONFIGURATION</span><h1>Settings</h1><p>Adjust the defaults HR uses for interviews, approvals, and notifications.</p></div>
        <div className="settings-header-note"><strong>HR Defaults</strong><span>Safe to edit. Secrets stay outside this page.</span></div>
      </header>

      <section className="settings-guide"><span className="settings-guide-icon">i</span><div><strong>What should I change?</strong><p>These are the live controls used by the portal and recruitment automation. Changes apply to new actions.</p></div></section>

      {loading && <div className="empty">Loading settings...</div>}
      {error && <ActionFeedback kind="error">{error}</ActionFeedback>}
      {saveError && <ValidationSummary error={saveError} title="Save failed" />}
      {message && <ActionFeedback kind="success">{message}</ActionFeedback>}

      {!loading && !error && grouped.filter(({ items }) => items.length > 0).map(({ category, items }) => <section className="card settings-section" key={category}>
        <div className="settings-section-header"><div><h2>{category}</h2><p>{categoryDescriptions[category] || "Additional portal configuration."}</p></div><span>{items.length} setting{items.length === 1 ? "" : "s"}</span></div>
        <div className="settings-grid">{items.length === 0 ? <p className="settings-empty">No settings in this category.</p> : items.map((setting) => {
          const badge = "Active";
          const badgeClass = "is-active";
          return <div className="settings-field" key={setting.key}>
            <div className="settings-field-heading"><label htmlFor={`setting-${setting.key}`}>{labelFor(setting.key)}</label><span className={`settings-runtime-status ${badgeClass}`}>{badge}</span></div>
            {isChoice(setting)
              ? <select id={`setting-${setting.key}`} value={setting.value || "No"} onChange={(event) => update(setting.key, event.target.value)}><option>Yes</option><option>No</option></select>
              : <input id={`setting-${setting.key}`} value={setting.value} placeholder="Not configured" onChange={(event) => update(setting.key, event.target.value)} />}
            <small>{setting.description || "No description provided."}</small>
          </div>;
        })}</div>
      </section>)}

      {!loading && !error && <div className="settings-actions"><span>Only important operational settings are shown here. Changes apply to new workflow actions.</span><button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Settings"}</button></div>}
    </main>
  );
}
