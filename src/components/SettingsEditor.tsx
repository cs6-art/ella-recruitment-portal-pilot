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
  /** For env/default-backed config keys: the value actually in effect. */
  effectiveValue?: string;
  source?: "sheet" | "env" | "default" | "stored";
  type?: "text" | "url" | "number" | "choice";
};

const categories = ["Access & Security", "Booking & Interview", "Workflow Rules", "Notifications", "Ella Credits"];
const hiddenSettingKeys = new Set(["Ella_Credit_Cost_CV_Analysis", "Ella_Credit_Cost_Phone_Interview"]);
const categoryDescriptions: Record<string, string> = {
  "Access & Security": "Who may sign in. Changing these affects authentication immediately.",
  "Booking & Interview": "Defaults for the calendar and candidate booking links.",
  "Workflow Rules": "Approval gates that keep candidate handoffs controlled.",
  Notifications: "How connected automation should notify candidates and HR.",
  "Ella Credits": "Published pricing is fixed at 1 credit per CV analysis and 10 credits per AI phone interview. The balance is managed in the Ella Credits panel below.",
};

const sourceLabel: Record<string, string> = {
  env: "From environment",
  default: "Default",
  sheet: "Overridden here",
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
        setSettings((data.settings || []).filter((setting: Setting) => categories.includes(setting.category) && !hiddenSettingKeys.has(setting.key)));
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

      <section className="settings-guide"><span className="settings-guide-icon">i</span><div><strong>What should I change?</strong><p>Active settings are consumed by portal runtime logic. Stored-only values are labelled so they are not mistaken for live controls.</p></div></section>

      {loading && <div className="empty">Loading settings...</div>}
      {error && <ActionFeedback kind="error">{error}</ActionFeedback>}
      {saveError && <ValidationSummary error={saveError} title="Save failed" />}
      {message && <ActionFeedback kind="success">{message}</ActionFeedback>}

      {!loading && !error && grouped.map(({ category, items }) => <section className="card settings-section" key={category}>
        <div className="settings-section-header"><div><h2>{category}</h2><p>{categoryDescriptions[category] || "Additional portal configuration."}</p></div><span>{items.length} setting{items.length === 1 ? "" : "s"}</span></div>
        <div className="settings-grid">{items.length === 0 ? <p className="settings-empty">No settings in this category.</p> : items.map((setting) => {
          const isConfigKey = Boolean(setting.type);
          const badge = isConfigKey && setting.source && sourceLabel[setting.source]
            ? sourceLabel[setting.source]
            : setting.connectionStatus === "active" ? "Active" : "Stored only";
          const badgeClass = setting.source === "sheet" || setting.connectionStatus === "active" ? "is-active" : "is-stored";
          return <div className="settings-field" key={setting.key}>
            <div className="settings-field-heading"><label htmlFor={`setting-${setting.key}`}>{labelFor(setting.key)}</label><span className={`settings-runtime-status ${badgeClass}`}>{badge}</span></div>
            {isChoice(setting)
              ? <select id={`setting-${setting.key}`} value={setting.value || setting.effectiveValue || "No"} onChange={(event) => update(setting.key, event.target.value)}><option>Yes</option><option>No</option></select>
              : <input id={`setting-${setting.key}`} value={setting.value} placeholder={isConfigKey ? (setting.effectiveValue || "Not set") : ""} onChange={(event) => update(setting.key, event.target.value)} />}
            <small>{setting.description || "No description provided."}{isConfigKey && setting.source !== "sheet" ? " Leave blank to keep using the environment value." : ""}</small>
          </div>;
        })}</div>
      </section>)}

      {!loading && !error && <div className="settings-actions"><span>Only important operational settings are shown here. Changes apply to new workflow actions.</span><button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Settings"}</button></div>}
    </main>
  );
}
