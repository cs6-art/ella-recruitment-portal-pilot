"use client";

import { useEffect, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import ValidationSummary from "@/components/ValidationSummary";
import { ELLA_CREDITS_REFRESH_EVENT, requestEllaCreditsRefresh } from "@/lib/ella-credits-events";

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
};

const eventLabels: Record<string, string> = {
  manual_topup: "Manual top-up",
  manual_adjustment: "Manual adjustment",
  cv_analysis: "AI CV analysis",
  phone_interview: "AI phone interview",
};

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
    setLoading(true);
    try {
      const response = await fetch("/api/ella-credits", { credentials: "same-origin", cache: "no-store" });
      const body = await response.json();
      if (!response.ok || body.success !== true) throw new Error(body.error || "Unable to load Ella Credits.");
      setData({ balance: body.balance, totals: body.totals, entries: body.entries || [] });
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

  return (
    <section className="card settings-section">
      <div className="settings-section-header">
        <div>
          <h2>Ella Credits</h2>
          <p>One shared balance meters AI usage: 1 credit per CV analysis, 10 credits per AI phone interview. Actions are blocked when the balance runs out.</p>
        </div>
        {data && <span>{data.balance} credit{data.balance === 1 ? "" : "s"} left</span>}
      </div>

      {loading && <div className="empty">Loading Ella Credits…</div>}
      {error && <ActionFeedback kind="error">{error}</ActionFeedback>}

      {!loading && !error && data && <>
        <div className="settings-integration-grid">
          <div className="settings-integration"><div><strong>{data.balance}</strong><span>Current balance</span></div></div>
          <div className="settings-integration"><div><strong>{data.totals.toppedUp}</strong><span>Total added</span></div></div>
          <div className="settings-integration"><div><strong>{data.totals.consumed}</strong><span>Total consumed</span></div></div>
        </div>

        {saveError && <ValidationSummary error={saveError} title="Update failed" />}
        {message && <ActionFeedback kind="success">{message}</ActionFeedback>}

        <div className="settings-grid">
          <div className="settings-field">
            <div className="settings-field-heading"><label htmlFor="ella-credit-amount">Adjust balance</label></div>
            <input id="ella-credit-amount" type="number" step="1" inputMode="numeric" placeholder="e.g. 2000 or -50" value={amount} onChange={(event) => setAmount(event.target.value)} />
            <small>Positive adds credits; negative removes them.</small>
          </div>
          <div className="settings-field">
            <div className="settings-field-heading"><label htmlFor="ella-credit-note">Note</label></div>
            <input id="ella-credit-note" value={note} maxLength={500} placeholder="Reason for this change" onChange={(event) => setNote(event.target.value)} />
            <small>Recorded in the ledger for audit.</small>
          </div>
        </div>

        <div className="settings-actions">
          <span>Changes take effect immediately for new AI actions.</span>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void submit()}>{saving ? "Saving…" : "Update Balance"}</button>
        </div>

        <div className="settings-section-header"><div><h2>Recent activity</h2><p>Last {data.entries.length} ledger entr{data.entries.length === 1 ? "y" : "ies"}.</p></div></div>
        {data.entries.length === 0 ? <p className="settings-empty">No credit activity yet.</p> : <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Event</th><th>Change</th><th>Balance</th><th>Reference</th><th>By</th></tr></thead>
          <tbody>{data.entries.map((entry) => <tr key={entry.entryId}>
            <td>{formatWhen(entry.timestamp)}</td>
            <td>{eventLabels[entry.event] || entry.event}{entry.note ? ` — ${entry.note}` : ""}</td>
            <td>{entry.creditsDelta > 0 ? `+${entry.creditsDelta}` : entry.creditsDelta}</td>
            <td>{entry.balanceAfter}</td>
            <td>{entry.reference || entry.roleId || "—"}</td>
            <td>{entry.actorName || entry.actorEmail || "—"}</td>
          </tr>)}</tbody>
        </table></div>}
      </>}
    </section>
  );
}
