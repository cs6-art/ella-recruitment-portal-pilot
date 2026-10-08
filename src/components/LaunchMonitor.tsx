"use client";

import { useCallback, useEffect, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { FEEDBACK_SOURCE_LABELS, type FeedbackSource } from "@/lib/feedback";
import styles from "./LaunchMonitor.module.css";

type Promotion = { name: string; credits: number; maxAllocations: number; allocatedCount: number; remaining: number; active: boolean; startsAt: string | null };
type MonitorOrganization = { name: string; createdAt: string; active: boolean; promotionCredits: number | null; promotionNumber: number | null; balance: number };
type FeedbackRow = {
  id: string; organizationName: string; userName: string; userEmail: string; source: FeedbackSource;
  navigationEase: number; taskCompletion: number; aiUsefulness: number; experiencedIssue: boolean;
  issueDescription: string; improvementSuggestion: string; createdAt: string;
};

const nf = new Intl.NumberFormat("en-US");
const when = (value: string) => { const time = Date.parse(value); return Number.isFinite(time) ? new Date(time).toLocaleString() : value; };
const average = (rows: FeedbackRow[], key: "navigationEase" | "taskCompletion" | "aiUsefulness") => rows.length ? (rows.reduce((sum, row) => sum + row[key], 0) / rows.length).toFixed(1) : "—";

/** Platform administrators: Event Welcome promotion progress, organization credits, and feedback. */
export default function LaunchMonitor() {
  const [promotion, setPromotion] = useState<Promotion | null>(null);
  const [created, setCreated] = useState(0);
  const [since, setSince] = useState(0);
  const [organizations, setOrganizations] = useState<MonitorOrganization[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [error, setError] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [monitor, notes] = await Promise.all([
        fetch("/api/launch-monitor", { credentials: "same-origin", cache: "no-store" }).then((response) => response.json()),
        fetch("/api/feedback", { credentials: "same-origin", cache: "no-store" }).then((response) => response.json()),
      ]);
      if (monitor.success !== true) throw new Error(monitor.error || "Unable to load the Launch Monitor.");
      setPromotion(monitor.promotion);
      setCreated(monitor.organizationsCreated);
      setSince(monitor.organizationsSincePromotionStart);
      setOrganizations(monitor.organizations || []);
      setError("");
      if (notes.success === true) { setFeedback(notes.feedback || []); setFeedbackError(""); }
      else setFeedbackError(notes.error || "Unable to load feedback.");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the Launch Monitor.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggle(active: boolean) {
    setSaving(true);
    try {
      const response = await fetch("/api/launch-monitor", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) });
      const body = await response.json();
      if (!response.ok || body.success !== true) throw new Error(body.error || "Unable to update the promotion.");
      setPromotion(body.promotion);
      setError("");
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Unable to update the promotion.");
    } finally {
      setSaving(false);
    }
  }

  const share = promotion ? Math.min(100, (promotion.allocatedCount / promotion.maxAllocations) * 100) : 0;

  return (
    <div className={styles.page}>
      {error && <ActionFeedback kind="error">{error}</ActionFeedback>}
      {loading && !promotion && !error && <p className={styles.muted}>Loading…</p>}

      {promotion && <section className={`card ${styles.card}`} aria-labelledby="promo-title">
        <div className={styles.promoHead}>
          <div>
            <h2 id="promo-title">Event Welcome Promotion</h2>
            <p className={styles.muted}>The first {nf.format(promotion.maxAllocations)} new organizations receive {nf.format(promotion.credits)} welcome credits. Later organizations receive the normal welcome credits.</p>
          </div>
          <span className={`${styles.status} ${promotion.active ? styles.on : styles.off}`}>{promotion.active ? "Active" : "Not active"}</span>
        </div>
        <div className={styles.progressNumbers}><b>{nf.format(promotion.allocatedCount)} / {nf.format(promotion.maxAllocations)}</b><span>organizations allocated</span><strong>{nf.format(promotion.remaining)} remaining</strong></div>
        <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={promotion.maxAllocations} aria-valuenow={promotion.allocatedCount} aria-label="Promotion slots used"><span style={{ width: `${share}%` }} /></div>
        <dl className={styles.facts}>
          <div><dt>Organizations created (total)</dt><dd>{nf.format(created)}</dd></div>
          <div><dt>Created since the promotion started</dt><dd>{promotion.startsAt ? nf.format(since) : "—"}</dd></div>
          <div><dt>Promotion started</dt><dd>{promotion.startsAt ? when(promotion.startsAt) : "Not started yet"}</dd></div>
        </dl>
        <div className={styles.actions}>
          {promotion.active
            ? <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void toggle(false)}>{saving ? "Saving…" : "Pause promotion"}</button>
            : <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void toggle(true)}>{saving ? "Saving…" : promotion.startsAt ? "Resume promotion" : "Start promotion"}</button>}
          <small className={styles.muted}>Only organizations created while the promotion is active can receive it. Existing organizations and balances are never changed.</small>
        </div>
      </section>}

      {!loading && !promotion && !error && <ActionFeedback kind="error">The promotion is not set up yet. Apply database migration 0041.</ActionFeedback>}

      <section className={`card ${styles.card}`} aria-labelledby="orgs-title">
        <h2 id="orgs-title">Organization credits</h2>
        {organizations.length === 0 ? <p className={styles.muted}>No client organizations yet.</p> : <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>Organization</th><th>Created</th><th>Welcome credits</th><th>Credits now</th></tr></thead>
          <tbody>{organizations.map((organization, index) => <tr key={`${organization.name}-${index}`}>
            <td>{organization.name}{!organization.active && <span className={styles.chip}>Inactive</span>}</td>
            <td>{when(organization.createdAt)}</td>
            <td>{organization.promotionCredits !== null ? `${nf.format(organization.promotionCredits)} (Event, #${organization.promotionNumber})` : "Normal"}</td>
            <td><b>{nf.format(organization.balance)}</b></td>
          </tr>)}</tbody>
        </table></div>}
      </section>

      <section className={`card ${styles.card}`} aria-labelledby="feedback-title">
        <div className={styles.promoHead}><h2 id="feedback-title">User feedback</h2><button type="button" className="btn btn-secondary btn-small" onClick={() => void load()} disabled={loading}>Refresh</button></div>
        {feedbackError && <ActionFeedback kind="error">{feedbackError}</ActionFeedback>}
        {feedback.length === 0 && !feedbackError ? <p className={styles.muted}>No feedback yet.</p> : <>
          <dl className={styles.facts}>
            <div><dt>Responses</dt><dd>{nf.format(feedback.length)}</dd></div>
            <div><dt>Average: easy to navigate (1–5)</dt><dd>{average(feedback, "navigationEase")}</dd></div>
            <div><dt>Average: completed tasks (1–5)</dt><dd>{average(feedback, "taskCompletion")}</dd></div>
            <div><dt>Average: AI useful (1–5)</dt><dd>{average(feedback, "aiUsefulness")}</dd></div>
            <div><dt>Reported a problem</dt><dd>{nf.format(feedback.filter((row) => row.experiencedIssue).length)}</dd></div>
          </dl>
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Date</th><th>Organization</th><th>Source</th><th>Navigation</th><th>Tasks</th><th>AI</th><th>Problem?</th><th>What happened</th><th>Most important to improve</th></tr></thead>
            <tbody>{feedback.map((row) => <tr key={row.id}>
              <td>{when(row.createdAt)}</td>
              <td>{row.organizationName}<small className={styles.sub}>{row.userName || row.userEmail}</small></td>
              <td>{FEEDBACK_SOURCE_LABELS[row.source] || row.source}</td>
              <td>{row.navigationEase}</td><td>{row.taskCompletion}</td><td>{row.aiUsefulness}</td>
              <td>{row.experiencedIssue ? "Yes" : "No"}</td>
              <td className={styles.long}>{row.issueDescription || "—"}</td>
              <td className={styles.long}>{row.improvementSuggestion || "—"}</td>
            </tr>)}</tbody>
          </table></div>
        </>}
      </section>
    </div>
  );
}
