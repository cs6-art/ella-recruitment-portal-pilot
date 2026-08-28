"use client";

import { useEffect, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import ValidationSummary from "@/components/ValidationSummary";
import { ELLA_CREDITS_REFRESH_EVENT, requestEllaCreditsRefresh } from "@/lib/ella-credits-events";
import styles from "./EllaCreditsPanel.module.css";

type LedgerEntry = {
  entryId: string;
  timestamp: string;
  type: "TopUp" | "Deduction";
  event: string;
  units: number;
  creditsDelta: number;
  balanceAfter: number;
  reference: string;
  roleId: string;
  actorName: string;
  actorEmail: string;
  note: string;
};

type LedgerResponse = {
  balance: number;
  totals: { toppedUp: number; consumed: number };
  entries: LedgerEntry[];
  pricing: {
    cvAnalysis: number;
    phoneInterview: number;
    discountThreshold: number;
    discountPercent: number;
  };
};

const defaultPricing = { cvAnalysis: 1, phoneInterview: 10, discountThreshold: 2000, discountPercent: 10 };

const eventLabels: Record<string, string> = {
  manual_topup: "Manual top-up",
  manual_adjustment: "Manual adjustment",
  volume_discount: "Volume discount bonus",
  cv_analysis: "AI CV analysis",
  phone_interview: "AI phone interview",
};

const nf = new Intl.NumberFormat("en-US");

function formatWhen(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : value;
}

export default function EllaCreditsPanel() {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/ella-credits", { credentials: "same-origin", cache: "no-store" });
      const body = await response.json();
      if (!response.ok || body.success !== true) throw new Error(body.error || "Unable to load Ella Credits.");
      setData({ balance: body.balance, totals: body.totals, entries: body.entries || [], pricing: { ...defaultPricing, ...(body.pricing || {}) } });
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Ella Credits.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const onRefresh = () => void load();
    window.addEventListener(ELLA_CREDITS_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(ELLA_CREDITS_REFRESH_EVENT, onRefresh);
  }, []);

  async function submit() {
    setSaving(true);
    setSaveError("");
    setMessage("");
    try {
      const parsedAmount = Number(amount);
      if (!Number.isInteger(parsedAmount) || parsedAmount === 0) throw new Error("Enter a non-zero whole number of credits (negative to deduct).");
      if (note.trim().length < 1) throw new Error("Add a short note explaining this change.");
      const response = await fetch("/api/ella-credits", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: parsedAmount, note: note.trim() }),
      });
      const body = await response.json();
      if (!response.ok || body.success !== true) throw new Error(body.error || "Unable to update the balance.");
      setMessage(body.message || "Balance updated.");
      setAmount("");
      setNote("");
      await load();
      requestEllaCreditsRefresh();
    } catch (submitError) {
      setSaveError(submitError instanceof Error ? submitError.message : "Unable to update the balance.");
    } finally {
      setSaving(false);
    }
  }

  const balance = data?.balance ?? 0;
  const pricing = data?.pricing;
  const headlineTone = balance <= 0 ? styles.empty : balance < 50 ? styles.low : "";

  return (
    <section className={`card ${styles.panel}`}>
      <div className={styles.header}>
        <div>
          <h2>Ella Credits</h2>
          <p>One shared balance meters AI usage — {pricing ? `${nf.format(pricing.cvAnalysis)} credits per CV analysis, ${nf.format(pricing.phoneInterview)} credits per AI phone interview.` : "Pricing is loaded from the active Ella Credits settings."} AI actions are blocked when the balance runs out.</p>
        </div>
        {data && (
          <div className={`${styles.headline} ${headlineTone}`}>
            <b>{nf.format(Math.max(0, balance))}</b>
            <span>credits left</span>
          </div>
        )}
      </div>

      {loading && !data && <div className={styles.loading}>Loading Ella Credits…</div>}
      {error && <div className={styles.feedback}><ActionFeedback kind="error">{error}</ActionFeedback></div>}

      {data && <>
        <div className={styles.stats}>
          <div className={styles.stat}><b>{nf.format(balance)}</b><span>Current balance</span></div>
          <div className={styles.stat}><b>{nf.format(data.totals.toppedUp)}</b><span>Total added</span></div>
          <div className={styles.stat}><b>{nf.format(data.totals.consumed)}</b><span>Total consumed</span></div>
        </div>

        {(saveError || message) && <div className={styles.feedback}>
          {saveError && <ValidationSummary error={saveError} title="Update failed" />}
          {message && <ActionFeedback kind="success">{message}</ActionFeedback>}
        </div>}

        <div className={styles.form}>
          <div className={`${styles.field} ${styles.amountField}`}>
            <label htmlFor="ella-credit-amount">Adjust balance</label>
            <input id="ella-credit-amount" type="number" step="1" inputMode="numeric" placeholder="e.g. 2000 or -50" value={amount} onChange={(event) => setAmount(event.target.value)} />
            <small>Positive adds credits; negative removes them. A single top-up of {nf.format(data.pricing.discountThreshold)}+ credits earns a {nf.format(data.pricing.discountPercent)}% bonus automatically.</small>
          </div>
          <div className={`${styles.field} ${styles.noteField}`}>
            <label htmlFor="ella-credit-note">Note</label>
            <input id="ella-credit-note" value={note} maxLength={500} placeholder="Reason for this change" onChange={(event) => setNote(event.target.value)} />
            <small>Recorded in the ledger for audit. Takes effect immediately for new AI actions.</small>
          </div>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void submit()}>{saving ? "Saving…" : "Update Balance"}</button>
        </div>

        <div className={styles.activity}>
          <h3>Recent activity</h3>
          <span>{data.entries.length} entr{data.entries.length === 1 ? "y" : "ies"}</span>
        </div>
        {data.entries.length === 0
          ? <p className={styles.empty}>No credit activity yet. Add a starting balance above to begin.</p>
          : <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>When</th><th>Event</th><th>Change</th><th>Balance</th><th>Reference</th><th>By</th></tr></thead>
            <tbody>{data.entries.map((entry) => (
              <tr key={entry.entryId}>
                <td>{formatWhen(entry.timestamp)}</td>
                <td>{eventLabels[entry.event] || entry.event}{entry.note ? ` — ${entry.note}` : ""}</td>
                <td className={`${styles.delta} ${entry.creditsDelta >= 0 ? styles.deltaPlus : styles.deltaMinus}`}>{entry.creditsDelta > 0 ? `+${nf.format(entry.creditsDelta)}` : nf.format(entry.creditsDelta)}</td>
                <td>{nf.format(entry.balanceAfter)}</td>
                <td>{entry.reference || entry.roleId || "—"}</td>
                <td>{entry.actorName || entry.actorEmail || "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>}
      </>}
    </section>
  );
}
