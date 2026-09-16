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
    phoneInterviewNoAnswer: number;
    phoneInterviewIncomplete: number;
    discountThreshold: number;
    discountPercent: number;
  };
};

type ActivityTypeFilter = "all" | "added" | "used";
type ActivityEventFilter = "all" | "manual" | "cv_analysis" | "voice_interview";

const defaultPricing = { cvAnalysis: 1, phoneInterview: 10, phoneInterviewNoAnswer: 5, phoneInterviewIncomplete: 8, discountThreshold: 2000, discountPercent: 10 };

const eventLabels: Record<string, string> = {
  manual_topup: "Manual top-up",
  manual_adjustment: "Manual adjustment",
  volume_discount: "Volume bonus",
  cv_analysis: "CV analysis",
  phone_interview: "Voice interview",
  phone_interview_no_answer: "Voice interview",
  phone_interview_incomplete: "Voice interview",
};

const nf = new Intl.NumberFormat("en-US");
const ACTIVITY_PAGE_SIZE = 10;

function formatWhen(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : value;
}

function eventFilterFor(event: string): ActivityEventFilter {
  if (event === "cv_analysis") return "cv_analysis";
  if (event.startsWith("phone_interview")) return "voice_interview";
  return "manual";
}

function recentFirst(entries: LedgerEntry[]) {
  return entries.slice().sort((left, right) => {
    const leftTime = Date.parse(left.timestamp);
    const rightTime = Date.parse(right.timestamp);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return rightTime - leftTime;
    return String(right.timestamp).localeCompare(String(left.timestamp));
  });
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
  const [activityPage, setActivityPage] = useState(1);
  const [activitySearch, setActivitySearch] = useState("");
  const [activityType, setActivityType] = useState<ActivityTypeFilter>("all");
  const [activityEvent, setActivityEvent] = useState<ActivityEventFilter>("all");

  async function load() {
    try {
      const response = await fetch("/api/ella-credits", { credentials: "same-origin", cache: "no-store" });
      const body = await response.json();
      if (!response.ok || body.success !== true) throw new Error(body.error || "Unable to load Credits.");
      setData({ balance: body.balance, totals: body.totals, entries: body.entries || [], pricing: { ...defaultPricing, ...(body.pricing || {}) } });
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Credits.");
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
      if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) throw new Error("Enter a positive whole number of credits.");
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
  const normalizedSearch = activitySearch.trim().toLowerCase();
  const filteredEntries = recentFirst(data?.entries ?? []).filter((entry) => {
    const matchesType = activityType === "all"
      || (activityType === "added" && entry.creditsDelta > 0)
      || (activityType === "used" && entry.creditsDelta < 0);
    const matchesEvent = activityEvent === "all" || eventFilterFor(entry.event) === activityEvent;
    const searchable = [eventLabels[entry.event] || entry.event, entry.note, entry.reference, entry.roleId, entry.actorName, entry.actorEmail].join(" ").toLowerCase();
    return matchesType && matchesEvent && (!normalizedSearch || searchable.includes(normalizedSearch));
  });
  const activityTotalPages = Math.max(1, Math.ceil(filteredEntries.length / ACTIVITY_PAGE_SIZE));
  const visibleActivityPage = Math.min(activityPage, activityTotalPages);
  const activityStart = (visibleActivityPage - 1) * ACTIVITY_PAGE_SIZE;
  const visibleEntries = filteredEntries.slice(activityStart, activityStart + ACTIVITY_PAGE_SIZE);
  const hasActivityFilters = Boolean(normalizedSearch) || activityType !== "all" || activityEvent !== "all";

  function clearActivityFilters() {
    setActivitySearch("");
    setActivityType("all");
    setActivityEvent("all");
    setActivityPage(1);
  }

  return (
    <section className={`card ${styles.panel}`}>
      <div className={styles.header}>
        <div>
          <h2>Credits</h2>
          <p>One shared credit balance meters AI usage — {pricing ? `${nf.format(pricing.cvAnalysis)} credit per CV analysis; AI voice interviews cost ${nf.format(pricing.phoneInterview)} when complete, ${nf.format(pricing.phoneInterviewIncomplete)} when incomplete, or ${nf.format(pricing.phoneInterviewNoAnswer)} when there is no answer.` : "Pricing is loaded from the active credit settings."} AI actions are blocked when the balance runs out.</p>
        </div>
        {data && (
          <div className={`${styles.headline} ${headlineTone}`}>
            <b>{nf.format(Math.max(0, balance))}</b>
            <span>credits left</span>
          </div>
        )}
      </div>

      {loading && !data && <div className={styles.loading}>Loading Credits…</div>}
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
            <label htmlFor="smile-credit-amount">Adjust balance</label>
            <input id="smile-credit-amount" type="number" min="1" step="1" inputMode="numeric" placeholder="e.g. 2000" value={amount} onChange={(event) => setAmount(event.target.value)} />
            <small>Adds credits only. A single top-up of {nf.format(data.pricing.discountThreshold)}+ credits earns a {nf.format(data.pricing.discountPercent)}% bonus automatically.</small>
          </div>
          <div className={`${styles.field} ${styles.noteField}`}>
            <label htmlFor="smile-credit-note">Note</label>
            <input id="smile-credit-note" value={note} maxLength={500} placeholder="Reason for this change" onChange={(event) => setNote(event.target.value)} />
            <small>Recorded in the ledger for audit. Takes effect immediately for new AI actions.</small>
          </div>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void submit()}>{saving ? "Saving…" : "Update Balance"}</button>
        </div>

        <div className={styles.activity}>
          <div className={styles.activityTitle}>
            <h3>Recent activity</h3>
            <span>{filteredEntries.length} matching entr{filteredEntries.length === 1 ? "y" : "ies"}</span>
          </div>
          <div className={styles.filters}>
            <label className={styles.searchField}>
              <span className={styles.srOnly}>Search credit activity</span>
              <input aria-label="Search credit activity" placeholder="Search activity" value={activitySearch} onChange={(event) => { setActivitySearch(event.target.value); setActivityPage(1); }} />
            </label>
            <select aria-label="Filter credit activity type" value={activityType} onChange={(event) => { setActivityType(event.target.value as ActivityTypeFilter); setActivityPage(1); }}>
              <option value="all">All activity</option>
              <option value="added">Credits added</option>
              <option value="used">Credits used</option>
            </select>
            <select aria-label="Filter credit activity event" value={activityEvent} onChange={(event) => { setActivityEvent(event.target.value as ActivityEventFilter); setActivityPage(1); }}>
              <option value="all">All events</option>
              <option value="manual">Manual changes</option>
              <option value="cv_analysis">CV analysis</option>
              <option value="voice_interview">Voice interviews</option>
            </select>
            {hasActivityFilters && <button type="button" className="btn btn-secondary btn-small" onClick={clearActivityFilters}>Clear</button>}
          </div>
        </div>
        {data.entries.length === 0
          ? <p className={styles.empty}>No credit activity yet. Add a starting balance above to begin.</p>
          : filteredEntries.length === 0
            ? <p className={styles.empty}>No activity matches the current filters.</p>
            : <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>When</th><th>Event</th><th>Change</th><th>Balance</th><th>Reference</th><th>By</th></tr></thead>
            <tbody>{visibleEntries.map((entry) => (
              <tr key={entry.entryId}>
                <td><span className={styles.cellClamp} title={formatWhen(entry.timestamp)}>{formatWhen(entry.timestamp)}</span></td>
                <td><span className={styles.eventName}>{eventLabels[entry.event] || entry.event}</span>{entry.note && <small className={styles.eventNote} title={entry.note}>{entry.note}</small>}</td>
                <td className={`${styles.delta} ${entry.creditsDelta >= 0 ? styles.deltaPlus : styles.deltaMinus}`}>{entry.creditsDelta > 0 ? `+${nf.format(entry.creditsDelta)}` : nf.format(entry.creditsDelta)}</td>
                <td>{nf.format(entry.balanceAfter)}</td>
                <td><span className={styles.cellClamp} title={entry.reference || entry.roleId || "—"}>{entry.reference || entry.roleId || "—"}</span></td>
                <td><span className={styles.cellClamp} title={entry.actorName || entry.actorEmail || "—"}>{entry.actorName || entry.actorEmail || "—"}</span></td>
              </tr>
            ))}{Array.from({ length: Math.max(0, ACTIVITY_PAGE_SIZE - visibleEntries.length) }, (_, index) => <tr className={styles.placeholderRow} aria-hidden="true" key={`placeholder-${index}`}><td colSpan={6}>&nbsp;</td></tr>)}</tbody>
          </table></div>}
        {filteredEntries.length > ACTIVITY_PAGE_SIZE && <div className={styles.pagination} aria-label="Credit activity pagination">
          <span>Showing {activityStart + 1}–{Math.min(activityStart + ACTIVITY_PAGE_SIZE, filteredEntries.length)} of {filteredEntries.length}</span>
          <button type="button" className="btn btn-secondary btn-small" disabled={visibleActivityPage === 1} onClick={() => setActivityPage((current) => Math.max(1, current - 1))}>Previous</button>
          <span>Page {visibleActivityPage} of {activityTotalPages}</span>
          <button type="button" className="btn btn-secondary btn-small" disabled={visibleActivityPage === activityTotalPages} onClick={() => setActivityPage((current) => Math.min(activityTotalPages, current + 1))}>Next</button>
        </div>}
      </>}
    </section>
  );
}
