"use client";

import { useId, useState } from "react";

import {
  FEEDBACK_IMPROVEMENT_QUESTION,
  FEEDBACK_ISSUE_DETAIL_PROMPT,
  FEEDBACK_ISSUE_QUESTION,
  FEEDBACK_RATING_QUESTIONS,
  FEEDBACK_TEXT_MAX_LENGTH,
  parseFeedback,
  type FeedbackSource,
} from "@/lib/feedback";
import styles from "./FeedbackForm.module.css";

type RatingKey = (typeof FEEDBACK_RATING_QUESTIONS)[number]["key"];

type FeedbackFormProps = {
  /** Where the form is shown; recorded with the answers. */
  source: FeedbackSource;
  /** Label of the main button, e.g. "Send feedback" or "Submit Feedback & Sign Out". */
  submitLabel: string;
  /** Called once the feedback is saved. */
  onSubmitted: () => void;
  /** Optional second button that always works, e.g. "Skip & Sign Out". */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Shown instead of the default when saving fails. */
  failureMessage?: string;
  /** Shown above the questions. */
  intro?: string;
};

/**
 * The single feedback survey. The sign-out prompt and Smile Bot both render
 * this component, so the questions can never drift apart.
 */
export default function FeedbackForm({ source, submitLabel, onSubmitted, secondaryLabel, onSecondary, failureMessage, intro }: FeedbackFormProps) {
  const formId = useId();
  const [ratings, setRatings] = useState<Partial<Record<RatingKey, number>>>({});
  const [experiencedIssue, setExperiencedIssue] = useState<boolean | null>(null);
  const [issueDescription, setIssueDescription] = useState("");
  const [improvementSuggestion, setImprovementSuggestion] = useState("");
  const [error, setError] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError("");
    setSaveFailed(false);
    const parsed = parseFeedback({
      source,
      ...ratings,
      experiencedIssue: experiencedIssue === null ? undefined : experiencedIssue,
      issueDescription,
      improvementSuggestion,
    });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.value),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.success !== true) {
        // A rejected answer (400) is something the person can fix; anything else is a save failure.
        if (response.status === 400 && typeof body?.error === "string") setError(body.error);
        else setSaveFailed(true);
        return;
      }
      onSubmitted();
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {intro && <p className={styles.intro}>{intro}</p>}

      {FEEDBACK_RATING_QUESTIONS.map((item, index) => {
        const name = `${formId}-${item.key}`;
        return (
          <fieldset className={styles.question} key={item.key}>
            <legend>{index + 1}. {item.question}</legend>
            <div className={styles.scale} role="radiogroup" aria-label={`${item.question} 1 is ${item.low}, 5 is ${item.high}`}>
              {[1, 2, 3, 4, 5].map((value) => (
                <label className={styles.scaleOption} key={value}>
                  <input type="radio" name={name} value={value} checked={ratings[item.key] === value} onChange={() => setRatings((current) => ({ ...current, [item.key]: value }))} />
                  <span>{value}</span>
                </label>
              ))}
            </div>
            <div className={styles.scaleLabels} aria-hidden="true"><span>{item.low}</span><span>{item.high}</span></div>
          </fieldset>
        );
      })}

      <fieldset className={styles.question}>
        <legend>4. {FEEDBACK_ISSUE_QUESTION}</legend>
        <div className={styles.choices} role="radiogroup" aria-label={FEEDBACK_ISSUE_QUESTION}>
          <label className={styles.choice}><input type="radio" name={`${formId}-issue`} checked={experiencedIssue === true} onChange={() => setExperiencedIssue(true)} /><span>Yes</span></label>
          <label className={styles.choice}><input type="radio" name={`${formId}-issue`} checked={experiencedIssue === false} onChange={() => setExperiencedIssue(false)} /><span>No</span></label>
        </div>
        {experiencedIssue === true && (
          <label className={styles.detail}>
            <span>{FEEDBACK_ISSUE_DETAIL_PROMPT}</span>
            <textarea rows={3} maxLength={FEEDBACK_TEXT_MAX_LENGTH} value={issueDescription} onChange={(event) => setIssueDescription(event.target.value)} />
          </label>
        )}
      </fieldset>

      <label className={`${styles.question} ${styles.openQuestion}`}>
        <span className={styles.legendText}>5. {FEEDBACK_IMPROVEMENT_QUESTION}</span>
        <textarea rows={3} maxLength={FEEDBACK_TEXT_MAX_LENGTH} value={improvementSuggestion} onChange={(event) => setImprovementSuggestion(event.target.value)} />
      </label>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {saveFailed && <p className={styles.error} role="alert">{failureMessage || "We couldn’t save your feedback. Please try again."}</p>}

      <div className={styles.actions}>
        {secondaryLabel && onSecondary && <button type="button" className="btn btn-secondary" onClick={onSecondary}>{secondaryLabel}</button>}
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}
