"use client";

import { Fragment, useEffect, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { useConfirmation } from "@/components/ConfirmationModal";
import { PROMO_CODE_CREDITS } from "@/lib/promo-code-rules";
import styles from "./PromoCodeRedeem.module.css";

type PromoCode = {
  id: string;
  code: string;
  credits: number;
  organizationId: string | null;
  organizationName: string;
  maxRedemptions: number | null;
  redemptionCount: number;
  expiresAt: string | null;
  active: boolean;
  note: string;
  createdByEmail: string;
  createdAt: string;
};
type Redemption = { organizationName: string; redeemedByName: string; redeemedByEmail: string; credits: number; redeemedAt: string };
type Organization = { id: string; name: string; active: boolean };

function when(value: string | null) {
  if (!value) return "—";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleDateString() : value;
}

function statusOf(code: PromoCode) {
  if (!code.active) return "Disabled";
  if (code.expiresAt && Date.parse(code.expiresAt) <= Date.now()) return "Expired";
  if (code.maxRedemptions !== null && code.redemptionCount >= code.maxRedemptions) return "Used up";
  return "Active";
}

/**
 * Promo code management on the Credits page, for McLink credit managers only
 * (the API enforces the same rule). Codes are always worth 210 credits.
 */
export default function PromoCodeManager() {
  const { confirm } = useConfirmation();
  const [codes, setCodes] = useState<PromoCode[] | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [form, setForm] = useState({ code: "", organizationId: "", maxRedemptions: "", expiresAt: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [openRedemptions, setOpenRedemptions] = useState<{ id: string; rows: Redemption[] } | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/ella-credits/promo-codes", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.json().then((data) => (response.ok && data.success ? data.codes as PromoCode[] : null)))
      .then((data) => { if (active && data) setCodes(data); })
      .catch(() => undefined);
    fetch("/api/ella-credits", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.json())
      .then((data) => { if (active && Array.isArray(data?.organizations)) setOrganizations(data.organizations); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!codes) return null;

  async function create() {
    setBusy(true); setFeedback(null);
    try {
      const response = await fetch("/api/ella-credits/promo-codes", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || "Unable to create the promo code.");
      setCodes(data.codes);
      setFeedback({ kind: "success", text: `Promo code ${form.code.trim().toUpperCase()} created. It adds ${PROMO_CODE_CREDITS} credits.` });
      setForm({ code: "", organizationId: "", maxRedemptions: "", expiresAt: "", note: "" });
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Unable to create the promo code." });
    } finally { setBusy(false); }
  }

  async function toggle(code: PromoCode) {
    if (code.active && !(await confirm({ title: `Disable ${code.code}?`, message: "Nobody will be able to redeem this code. Credits already added stay in place.", confirmLabel: "Disable code", tone: "danger" }))) return;
    setBusy(true); setFeedback(null);
    try {
      const response = await fetch("/api/ella-credits/promo-codes", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: code.id, active: !code.active }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || "Unable to update the promo code.");
      setCodes(data.codes);
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Unable to update the promo code." });
    } finally { setBusy(false); }
  }

  async function showRedemptions(code: PromoCode) {
    if (openRedemptions?.id === code.id) { setOpenRedemptions(null); return; }
    const response = await fetch(`/api/ella-credits/promo-codes?redemptionsFor=${encodeURIComponent(code.id)}`, { credentials: "same-origin", cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    setOpenRedemptions({ id: code.id, rows: response.ok && Array.isArray(data.redemptions) ? data.redemptions : [] });
  }

  return <section className="card settings-section" aria-labelledby="promo-code-manager-title">
    <div className="card-header"><div>
      <h2 id="promo-code-manager-title">Promo Codes</h2>
      <p>Create codes that add {PROMO_CODE_CREDITS} Smile Credits to an organization&apos;s shared balance. Each organization can redeem a code once. Visible to McLink credit managers only.</p>
    </div></div>
    <form className={styles.managerForm} onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <label><span>Code</span><input required value={form.code} maxLength={40} placeholder="e.g. WELCOME210" onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} /></label>
      <label><span>Organization</span><select value={form.organizationId} onChange={(event) => setForm({ ...form, organizationId: event.target.value })}>
        <option value="">Any organization</option>
        {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
      </select></label>
      <label><span>Total uses <small>(optional)</small></span><input type="number" min={1} step={1} value={form.maxRedemptions} placeholder="No limit" onChange={(event) => setForm({ ...form, maxRedemptions: event.target.value })} /></label>
      <label><span>Expires on <small>(optional)</small></span><input type="date" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} /></label>
      <label className={styles.managerWide}><span>Note <small>(optional)</small></span><input value={form.note} maxLength={300} placeholder="Campaign or reason" onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
      <button type="submit" className="btn btn-primary" disabled={busy || !form.code.trim()}>{busy ? "Saving…" : "Create code"}</button>
    </form>
    {feedback && <div className={styles.managerFeedback}><ActionFeedback kind={feedback.kind}>{feedback.text}</ActionFeedback></div>}
    {codes.length === 0 ? <p className={styles.managerEmpty}>No promo codes yet.</p> : <div className={styles.managerTableWrap}><table className={styles.managerTable}>
      <thead><tr><th>Code</th><th>Status</th><th>Credits</th><th>For</th><th>Used</th><th>Expires</th><th>Actions</th></tr></thead>
      <tbody>{codes.map((code) => <Fragment key={code.id}>
        <tr>
          <td><strong>{code.code}</strong>{code.note && <small>{code.note}</small>}</td>
          <td>{statusOf(code)}</td>
          <td>+{code.credits}</td>
          <td>{code.organizationName || "Any organization"}</td>
          <td>{code.redemptionCount}{code.maxRedemptions !== null ? ` / ${code.maxRedemptions}` : ""}</td>
          <td>{when(code.expiresAt)}</td>
          <td className={styles.managerActions}>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => void showRedemptions(code)}>{openRedemptions?.id === code.id ? "Hide uses" : "View uses"}</button>
            <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => void toggle(code)}>{code.active ? "Disable" : "Enable"}</button>
          </td>
        </tr>
        {openRedemptions?.id === code.id && <tr><td colSpan={7}>
          {openRedemptions.rows.length === 0 ? "Not redeemed yet." : <ul className={styles.managerUses}>{openRedemptions.rows.map((row, index) => <li key={index}>{row.organizationName}: +{row.credits} by {row.redeemedByName || row.redeemedByEmail} on {when(row.redeemedAt)}</li>)}</ul>}
        </td></tr>}
      </Fragment>)}</tbody>
    </table></div>}
  </section>;
}
