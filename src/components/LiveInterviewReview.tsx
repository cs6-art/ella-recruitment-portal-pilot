"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  ANALYSIS_STATE_LABELS,
  HR_REVIEW_DISCLAIMER,
  INTEGRITY_EVENT_LABELS,
  INTERVIEW_STATE_LABELS,
  processingFailureMessage,
  type IntegrityEventType,
  type TranscriptTurn,
} from "@/lib/live-interview";
import { ASSESSMENT_BASIS, RATING_SCALE, ratingLabel, RUBRIC_VERSION } from "@/lib/live-interview-scoring";
import type { LiveInterviewReview as Review } from "@/lib/live-interview-store";

import "./live-interview.css";

type Props = { applicationId: string; initialReview: Review; canRetry: boolean };

const PROCESSING = new Set(["INTERVIEW_IN_PROGRESS", "INTERVIEW_COMPLETED", "TRANSCRIPTION_PROCESSING", "ANALYSIS_PROCESSING"]);
const POLL_MS = 5_000;
const POLL_LIMIT_MS = 4 * 60 * 1000;
// Fixed wording only: raw server/provider errors are never rendered here.
const RETRY_REQUEST_FAILED = "The analysis could not be restarted. Please try again in a moment.";

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Singapore" });

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : `${dateTime.format(date)} (SGT)`;
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "Not available";
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}

function turnTime(turn: TranscriptTurn) {
  if (turn.relativeMs !== null) {
    const total = Math.round(turn.relativeMs / 1000);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  return turn.occurredAt ? clock.format(new Date(turn.occurredAt)) : "";
}

function speakerLabel(turn: TranscriptTurn) {
  return turn.speaker === "ai_interviewer" ? "Smile (Live Avatar)" : "Applicant";
}

function recordingLabel(review: Review) {
  switch (review.recording.status) {
    case "available": return "Recording saved to the secure Google Drive folder and available for HR playback";
    case "not_consented": return "Not recorded — the applicant did not consent to recording";
    case "not_configured": return "Not recorded — Google Drive storage is not configured";
    case "pending": return "The recording is being prepared";
    case "uploading": return "The recording is being uploaded to secure Google Drive storage";
    case "failed": return "The recording could not be saved and is not available";
    case "deleted": return "The recording was deleted after the retention period. The transcript and review remain";
    default: return "Recording status not available";
  }
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: ReactNode[] = [];
  let index = 0;
  while (index < text.length) {
    const found = lower.indexOf(needle, index);
    if (found === -1) { parts.push(text.slice(index)); break; }
    if (found > index) parts.push(text.slice(index, found));
    parts.push(<mark key={found}>{text.slice(found, found + needle.length)}</mark>);
    index = found + needle.length;
  }
  return <>{parts}</>;
}

export default function LiveInterviewReview({ applicationId, initialReview, canRetry }: Props) {
  const [review, setReview] = useState(initialReview);
  const [pollExpired, setPollExpired] = useState(false);
  const [pollError, setPollError] = useState("");
  const [retrying, setRetrying] = useState(false);
  // Set once HR retries in this view, so a repeat failure gets the
  // "temporarily unavailable" wording instead of "please retry".
  const [retriedByHr, setRetriedByHr] = useState(false);
  const [pollKey, setPollKey] = useState(0);
  const [actionError, setActionError] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [highlightSeq, setHighlightSeq] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const endpoint = `/api/applicants/${encodeURIComponent(applicationId)}/live-interview`;
  const processing = PROCESSING.has(review.status);
  const recordingWaiting = review.recording.status === "pending" || review.recording.status === "uploading";

  useEffect(() => {
    if (!processing && !recordingWaiting) return;
    const startedAt = Date.now();
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (Date.now() - startedAt > POLL_LIMIT_MS) {
        if (timer) window.clearTimeout(timer);
        if (!cancelled) setPollExpired(true);
        return;
      }
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        const body = await response.json() as { success?: boolean; review?: Review | null };
        if (!response.ok || !body.success) throw new Error("Interview refresh failed");
        if (!cancelled) {
          setPollError("");
          if (body.review) setReview(body.review);
        }
      } catch {
        // Keep the last known state, explain that it may be stale, and retry.
        if (!cancelled) setPollError("The latest interview update could not be loaded. Showing the last saved details; we’ll try again automatically.");
      }
      if (!cancelled && document.visibilityState === "visible") timer = window.setTimeout(poll, POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (timer) window.clearTimeout(timer);
        timer = null;
      } else {
        if (timer) window.clearTimeout(timer);
        void poll();
      }
    };
    timer = window.setTimeout(poll, POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [processing, recordingWaiting, endpoint, pollKey]);

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    setActionError("");
    try {
      const response = await fetch(`${endpoint}/retry`, { method: "POST" });
      const body = await response.json().catch(() => ({})) as { success?: boolean; review?: Review | null };
      if (!response.ok || !body.success) {
        setActionError(response.status === 403 ? "You do not have permission to retry interview analysis." : RETRY_REQUEST_FAILED);
        return;
      }
      setRetriedByHr(true);
      setPollExpired(false);
      setPollKey((value) => value + 1);
      if (body.review) setReview(body.review);
    } catch {
      setActionError(RETRY_REQUEST_FAILED);
    } finally {
      setRetrying(false);
    }
  }

  function jumpTo(seq: number) {
    setQuery("");
    setHighlightSeq(seq);
    window.requestAnimationFrame(() => document.getElementById(`live-turn-${review.sessionId}-${seq}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  async function copyTranscript() {
    const text = review.turns.map((turn) => `${speakerLabel(turn)}${turnTime(turn) ? ` [${turnTime(turn)}]` : ""}: ${turn.text}`).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setActionError("Copy is not available in this browser.");
    }
  }

  const visibleTurns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? review.turns.filter((turn) => turn.text.toLowerCase().includes(needle)) : review.turns;
  }, [query, review.turns]);

  const analysis = review.analysis;
  const assessment = analysis?.assessment;
  const ratingsByQuestion = new Map((assessment?.questionRatings || []).map((item) => [item.questionIndex, item]));
  const questionReview = new Map((analysis?.questionReviews || []).map((item) => [item.questionIndex, item]));
  const refs = (turnRefs: number[]) => turnRefs.length > 0 && <button type="button" className="live-review-ref" onClick={() => jumpTo(turnRefs[0])}>View in transcript (turn {turnRefs.join(", ")})</button>;
  const failed = review.analysisState === "failed" && !processing;
  const analysisLabel = processing && retriedByHr ? "Retrying analysis…" : ANALYSIS_STATE_LABELS[review.analysisState];
  const integrity = review.integrityEvents.filter((event) => event.type !== "tab_visible" && event.type !== "network_online");

  return <div className="live-review">
    <p className="live-review-disclaimer">{HR_REVIEW_DISCLAIMER}</p>
    {pollError && <div className="live-review-status is-failed" role="status" aria-live="polite">{pollError}</div>}

    <div className="live-review-block">
      <h4>Interview Overview</h4>
      <div className="applicant-detail-inline-fields">
        <div className="applicant-detail-field"><span>Applicant Name</span><strong>{review.applicantName || "Not provided"}</strong></div>
        <div className="applicant-detail-field"><span>Position Applied For</span><strong>{review.roleTitle || "Not provided"}</strong></div>
        <div className="applicant-detail-field"><span>Interview Date</span><strong>{formatDate(review.interviewDate)}</strong></div>
        <div className="applicant-detail-field"><span>Interview Duration</span><strong>{formatDuration(review.durationSeconds)}</strong></div>
        <div className="applicant-detail-field"><span>Live Avatar Interview Status</span><strong>{INTERVIEW_STATE_LABELS[review.interviewState] || "Status not available"}</strong></div>
        <div className="applicant-detail-field"><span>AI Review Status</span><strong>{review.interviewState === "completed" ? analysisLabel : "Not started"}</strong></div>
        <div className="applicant-detail-field"><span>Consent Status</span><strong>{review.consent.given ? `Given ${formatDate(review.consent.at)} · notice ${review.consent.version}` : "Not given"}</strong></div>
        <div className="applicant-detail-field"><span>Recording Storage</span><strong>{recordingLabel(review)}</strong></div>
        <div className="applicant-detail-field"><span>Transcript Source</span><strong>{review.transcriptSource === "provider" ? "Live Avatar (HeyGen) session transcript" : review.transcriptSource === "client_capture" ? "Browser capture — provider transcript unavailable" : review.transcriptSource === "none" ? "Could not be retrieved" : "Not yet available"}</strong></div>
      </div>
    </div>

    {(processing || failed) && <div className={`live-review-status ${failed ? "is-failed" : ""}`} role="status">
      {processing && !pollExpired && <span className="live-review-loading">{retriedByHr ? "Retrying analysis…" : review.status === "INTERVIEW_IN_PROGRESS" ? "The interview is in progress." : "The interview is complete and is being analysed"} — this updates automatically.</span>}
      {processing && pollExpired && <span>Analysis is taking longer than expected. The interview recording and transcript are preserved.</span>}
      {failed && <span>{processingFailureMessage(review.failureStage || "analysis", retriedByHr)}{review.errorReference ? ` Reference: ${review.errorReference}.` : ""}</span>}
      {canRetry && (failed || pollExpired) && <button type="button" className="btn btn-secondary" onClick={() => void retry()} disabled={retrying} aria-busy={retrying}>{retrying ? "Retrying analysis…" : "Retry analysis"}</button>}
    </div>}
    {actionError && <p className="error-box" role="alert">{actionError}</p>}

    {review.reviewFlags.length > 0 && <div className="live-review-block">
      <h4>Items Flagged for HR Attention</h4>
      <ul className="live-review-flags">{review.reviewFlags.map((flag) => <li key={flag.code}>{flag.message}</li>)}</ul>
    </div>}

    <div className="live-review-block">
      <h4>Live Avatar Assessment</h4>
      {assessment ? <>
        <div className={`live-review-assessment ${assessment.status === "scored" ? `is-${assessment.band}` : "is-unscored"}`}>
          <div className="live-review-score"><span>Score</span><strong>{assessment.status === "scored" ? `${assessment.score}%` : "—"}</strong></div>
          <div>
            <strong>{assessment.bandLabel}</strong>
            <p>Suggested next step: {assessment.suggestedNextStep}</p>
            {assessment.status === "scored" ? <p>Based on {assessment.countedQuestions} of {assessment.totalQuestions} questions.</p> : <p>{assessment.notScoredReason}</p>}
          </div>
        </div>
        <details className="live-review-method">
          <summary>How this is scored</summary>
          <p>{ASSESSMENT_BASIS}</p>
          <ul className="live-review-evidence">{RATING_SCALE.map((item) => <li key={item.rating}><strong>{item.rating} — {item.label}</strong><span>{item.description}</span></li>)}</ul>
          <p>Score = average rating across the questions that could be assessed, as a percentage of the maximum. 75+ strong, 55–74 good, 35–54 partial, under 35 limited. Rubric version {RUBRIC_VERSION}.</p>
        </details>
      </> : <p className="live-review-loading">{processing ? "The assessment is being prepared from the transcript." : failed ? "The assessment is unavailable until the analysis is retried." : "No assessment is available for this interview."}</p>}
    </div>

    <div className="live-review-block">
      <h4>Live Avatar Summary</h4>
      {analysis ? <>
        <div className="applicant-copy-block"><span>Interview Summary</span><p>{analysis.interviewSummary || "No summary was produced."}</p></div>
        <div className="applicant-copy-columns">
          <div><span>Relevant Experience</span>{analysis.relevantExperience.length ? <ul className="live-review-evidence">{analysis.relevantExperience.map((item, index) => <li key={index}><strong>{item.point}</strong>{item.evidence && <q>{item.evidence}</q>}{refs(item.turnRefs)}</li>)}</ul> : <p>None identified in the answers.</p>}</div>
          <div><span>Skills Mentioned</span>{analysis.skillsMentioned.length ? <ul className="live-review-evidence">{analysis.skillsMentioned.map((item, index) => <li key={index}><strong>{item.skill}</strong>{item.evidence && <q>{item.evidence}</q>}{refs(item.turnRefs)}</li>)}</ul> : <p>No specific skills were discussed.</p>}</div>
        </div>
        <div className="applicant-copy-columns">
          <div><span>Key Strengths Evidenced in Answers</span>{analysis.strengthsEvidenced.length ? <ul className="live-review-evidence">{analysis.strengthsEvidenced.map((item, index) => <li key={index}><strong>{item.strength}</strong><q>{item.evidence}</q>{refs(item.turnRefs)}</li>)}</ul> : <p>No strengths were supported by specific statements.</p>}</div>
          <div><span>Areas HR May Want to Clarify</span>{analysis.areasToClarify.length ? <ul className="live-review-evidence">{analysis.areasToClarify.map((item, index) => <li key={index}><strong>{item.topic}</strong>{item.reason && <span>{item.reason}</span>}{refs(item.turnRefs)}</li>)}</ul> : <p>None identified.</p>}</div>
        </div>
        {analysis.notableResponses.length > 0 && <div className="applicant-copy-block"><span>Notable Responses</span><ul className="live-review-evidence">{analysis.notableResponses.map((item, index) => <li key={index}><strong>{item.title}</strong>{item.quote && <q>{item.quote}</q>}{refs(item.turnRefs)}</li>)}</ul></div>}
      </> : <p className="live-review-loading">{processing ? "The AI summary is being prepared from the transcript." : failed ? "The AI summary is unavailable until the analysis is retried." : "No AI summary is available for this interview."}</p>}
    </div>

    <div className="live-review-block">
      <h4>Question-by-Question Review</h4>
      {review.questions.length === 0 ? <p className="live-review-loading">{review.turns.length ? "No substantive interview questions were detected in the transcript." : "Questions appear here once the transcript is available."}</p>
        : review.questions.map((pair, index) => {
          const item = questionReview.get(pair.questionIndex);
          return <article key={pair.questionIndex} className="live-review-question" id={`live-question-${review.sessionId}-${pair.questionIndex}`}>
            <h5>Question {index + 1}</h5>
            <dl>
              <div><dt>AI Question</dt><dd>{pair.question}</dd></div>
              <div><dt>Applicant Answer</dt><dd>{pair.answer || "No spoken answer was captured for this question."}</dd></div>
              {ratingsByQuestion.get(pair.questionIndex) && <div><dt>Evidence Rating</dt><dd>{ratingsByQuestion.get(pair.questionIndex)?.rating !== null ? `${ratingsByQuestion.get(pair.questionIndex)?.rating} / 4 — ${ratingLabel(ratingsByQuestion.get(pair.questionIndex)?.rating ?? null)}` : "Not rated"}{ratingsByQuestion.get(pair.questionIndex)?.counted ? "" : ` (not counted: ${ratingsByQuestion.get(pair.questionIndex)?.reason})`}</dd></div>}
              {item?.analysis && <div><dt>AI Analysis</dt><dd>{item.analysis}</dd></div>}
              {item?.jobCriteria && <div><dt>Relevant Job Criteria</dt><dd>{item.jobCriteria}</dd></div>}
              {item?.evidence && <div><dt>Evidence</dt><dd>{item.evidence}</dd></div>}
            </dl>
            <button type="button" className="live-review-ref" onClick={() => jumpTo(pair.turnSeqs[0])}>Jump to this question in the transcript</button>
          </article>;
        })}
    </div>

    <div className="live-review-block">
      <h4>Full Interview Transcript</h4>
      {review.turns.length === 0 ? <p className="live-review-loading">{processing ? "The transcript is being retrieved." : "No transcript is available."}</p> : <>
        <div className="live-review-toolbar">
          <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setHighlightSeq(null); }} placeholder="Search transcript…" aria-label="Search transcript" />
          {review.questions.length > 0 && <select aria-label="Jump to question" value="" onChange={(event) => { const seq = Number(event.target.value); if (seq) jumpTo(seq); }}>
            <option value="">Jump to question…</option>
            {review.questions.map((pair, index) => <option key={pair.questionIndex} value={pair.turnSeqs[0]}>Question {index + 1}</option>)}
          </select>}
          <button type="button" className="btn btn-secondary" onClick={() => setExpanded((value) => !value)}>{expanded ? "Collapse" : "Expand"}</button>
          <button type="button" className="btn btn-secondary" onClick={() => void copyTranscript()}>{copied ? "Copied" : "Copy transcript"}</button>
        </div>
        {query && <p className="live-review-loading">{visibleTurns.length} matching turn{visibleTurns.length === 1 ? "" : "s"}</p>}
        <div ref={transcriptRef} className={`live-review-transcript ${expanded ? "is-expanded" : ""}`} tabIndex={0} aria-label="Interview transcript">
          {visibleTurns.map((turn) => <div key={turn.seq} id={`live-turn-${review.sessionId}-${turn.seq}`} className={`live-review-turn ${turn.speaker === "ai_interviewer" ? "is-ai" : "is-applicant"} ${highlightSeq === turn.seq ? "is-highlighted" : ""}`}>
            <header><strong>{speakerLabel(turn)}</strong><span>#{turn.seq}{turnTime(turn) ? ` · ${turnTime(turn)}` : ""}</span></header>
            <p><Highlight text={turn.text} query={query.trim()} /></p>
          </div>)}
        </div>
      </>}
    </div>

    <div className="live-review-block" aria-busy={review.recording.status === "pending" || review.recording.status === "uploading"}>
      <h4>Live Avatar Recording</h4>
      {review.recording.available
        ? <video className="live-review-video" controls preload="metadata" src={`${endpoint}/recording`}>Your browser cannot play this recording.</video>
        : <p className="live-review-loading" role="status" aria-live="polite">{recordingLabel(review)}</p>}
    </div>

    <div className="live-review-block">
      <h4>Session Review Indicators</h4>
      <p className="live-review-loading">Objective technical events recorded during the session. They are prompts for HR review only, are not evidence of misconduct, and are never used to accept or reject an applicant.</p>
      {integrity.length === 0 ? <p className="live-review-loading">No session events were recorded.</p>
        : <ul className="live-review-integrity">{integrity.map((event, index) => <li key={`${event.type}-${index}`}>{formatDate(event.at)} — {INTEGRITY_EVENT_LABELS[event.type as IntegrityEventType] || event.type}{event.detail ? ` (${event.detail})` : ""}</li>)}</ul>}
    </div>
  </div>;
}
