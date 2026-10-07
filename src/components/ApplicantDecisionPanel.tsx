"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import ActionFeedback from "@/components/ActionFeedback";
import ValidationSummary from "@/components/ValidationSummary";
import StatusBadge from "@/components/ui/StatusBadge";
import { useConfirmation } from "@/components/ConfirmationModal";
import { applicantDecisionLabel, LIVE_AVATAR_REVIEW_LABEL, type ApplicantInterviewMode } from "@/lib/applicant-stage-labels";
import { decisionCommentRequired, REJECTION_REASON_REQUIRED_MESSAGE } from "@/lib/applicant-decision-rules";
import { DEFAULT_ROLE_INTERVIEW_TYPE, roleAllowsInterview, ROLE_INTERVIEW_TYPE_LABELS, type RoleInterviewType } from "@/lib/interview-type";

type Stage = "resume" | "voice" | "final";
type SavedDecision = { decision: string; comments: string };
type Props = {
  applicationId: string;
  currentStage: string;
  resumeDecision: string;
  resumeComments: string;
  voiceDecision: string;
  voiceComments: string;
  voiceStatus: string;
  finalInterviewStatus: string;
  finalStatus: string;
  finalComments: string;
  finalBookingLink: string;
  voiceBookingLink: string;
  voiceRetryEligible: boolean;
  canReview: boolean;
  interviewMode: ApplicantInterviewMode;
  /** False when no AI screening result exists yet; HR can still send an interview directly. */
  screened?: boolean;
  /** Direct phone / Live Avatar invitations (Postgres portal only). */
  canSendInterview?: boolean;
  /** The role's Interview type: which send actions HR sees (default "both"). */
  roleInterviewType?: RoleInterviewType;
};

function isDecided(current: string) {
  const normalized = current.trim().toLowerCase();
  return normalized === "approve" || normalized === "approved" ||
    normalized === "reject" || normalized === "rejected" ||
    normalized === "manual review" || normalized === "return for review" || normalized === "to review" ||
    normalized.includes("passed") || normalized.includes("rejected");
}

function isRejectedDecision(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "reject" || normalized === "rejected" || normalized.includes("rejected");
}

function reviewStage(props: Props): Stage {
  // The canonical workflow stage is the source of truth when it is available
  // (Postgres applicants); the status-text heuristics below keep the Sheets
  // applicants working where only display labels are provided.
  const stageKey = props.currentStage.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["approved_for_final", "final_scheduled", "final_decision_pending", "passed_final"].includes(stageKey)
    || /completed/i.test(props.finalInterviewStatus)
    || /(?:final|hr) interview (passed|rejected)/i.test(props.finalStatus)) return "final";
  // A voice interview that was not answered or not completed still needs an HR
  // decision. Treating it as an unrecognized status falls back to the
  // already-decided CV stage and hides the voice approval actions.
  if (stageKey === "voice_review_pending"
    || /interviewed|completed|incomplete|no[_ -]?answer|no[_ -]?show/i.test(`${props.voiceStatus} ${props.finalStatus}`)) return "voice";
  return "resume";
}

function CompletedDecision({ title, decision, comments, link, linkLabel = "Open Face-to-Face Interview Booking Link" }: { title: string; decision: string; comments: string; link?: string; linkLabel?: string }) {
  return <div className="applicant-completed-decision"><div className="applicant-decision-title"><strong>{title}</strong><StatusBadge value={applicantDecisionLabel(decision)} tone={isRejectedDecision(decision) ? "negative" : "positive"} /></div>{link && <a className="applicant-booking-link" href={link} target="_blank" rel="noreferrer">{linkLabel}</a>}{comments ? <div className="applicant-completed-comments"><span>Comments</span><p>{comments}</p></div> : <p className="applicant-completed-empty">No comments were recorded for this decision.</p>}</div>;
}

type SendInterviewResult = { ok: true; message: string } | { ok: false; message: string; blocked: boolean; canSwitch: boolean };

/** POST "Send Phone / Avatar Interview"; `switchType` replaces an unused invitation of the other type. */
async function postInterviewInvitation(applicationId: string, kind: "voice" | "avatar", comment: string, switchType: boolean): Promise<SendInterviewResult> {
  const response = await fetch(`/api/applicants/${encodeURIComponent(applicationId)}/interview-invitation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, comment, switchType }) });
  const data = await response.json().catch(() => ({}));
  if (response.ok && data.success) return { ok: true, message: String(data.message || "Interview sent.") };
  const blocked = data.outcome === "already_invited" || data.outcome === "interview_exists" || data.outcome === "insufficient_credits";
  return { ok: false, message: String(data.error || "The interview invitation could not be sent."), blocked, canSwitch: data.canSwitch === true };
}

const interviewName = (kind: "voice" | "avatar") => kind === "avatar" ? "Live Avatar interview" : "phone interview";

/**
 * Shown while the applicant has an unused interview invitation: HR can switch
 * it to the other interview type. The old link stops working and the
 * candidate gets the new invitation. Not possible once a call is booked or a
 * Live Avatar interview has started (the server re-checks).
 */
function InterviewTypeSwitch({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "warning" | "error"; text: string } | null>(null);
  async function switchTo(kind: "voice" | "avatar") {
    if (!(await confirm({ title: `Switch to a ${interviewName(kind)}?`, message: `The applicant's current interview invitation link will stop working and they will be emailed a ${interviewName(kind)} instead.`, confirmLabel: "Switch interview" }))) return;
    setBusy(true); setFeedback(null);
    try {
      const result = await postInterviewInvitation(applicationId, kind, "", true);
      setFeedback({ kind: result.ok ? "success" : result.blocked ? "warning" : "error", text: result.message });
      if (result.ok) { router.refresh(); router.replace(`/applicants/${encodeURIComponent(applicationId)}?interviewSwitched=${Date.now()}`); }
    } catch { setFeedback({ kind: "error", text: "The interview could not be switched. Please try again." }); }
    finally { setBusy(false); }
  }
  return <div className="applicant-interview-switch">
    <div className="applicant-decision-title"><strong>Change interview type</strong></div>
    <p>The applicant hasn&apos;t booked or started their interview yet, so you can send the other type instead.</p>
    <div className="applicant-decision-actions">
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void switchTo("voice")}>Switch to Phone Interview</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void switchTo("avatar")}>Switch to Avatar Interview</button>
    </div>
    {feedback && <ActionFeedback kind={feedback.kind} className="applicant-decision-success">{feedback.text}</ActionFeedback>}
  </div>;
}

function DecisionRow({ stage, title, description, current, link, enabled = true, applicationId, canReview, retryEligible = false, screened = true, canSendInterview = false, roleInterviewType = DEFAULT_ROLE_INTERVIEW_TYPE, onSaved }: {
  stage: Stage;
  title: string;
  description: string;
  current: string;
  link?: string;
  enabled?: boolean;
  applicationId: string;
  canReview: boolean;
  retryEligible?: boolean;
  screened?: boolean;
  canSendInterview?: boolean;
  roleInterviewType?: RoleInterviewType;
  onSaved: (message: string, decision: string, comments: string) => void;
}) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const [blockedNotice, setBlockedNotice] = useState("");
  const [switchOffer, setSwitchOffer] = useState<"voice" | "avatar" | null>(null);
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState("");
  const [error, setError] = useState("");
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [retryMessage, setRetryMessage] = useState("");
  const decided = isDecided(current);

  async function sendBookingLink() {
    setRetryBusy(true); setRetryError(""); setRetryMessage("");
    try {
      const response = await fetch(`/api/applicants/${encodeURIComponent(applicationId)}/voice-booking`, { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Unable to send a new booking link.");
      setRetryMessage("A fresh booking link is on its way to the candidate. No call will be placed until the candidate books a new time.");
      router.refresh();
      router.replace(`/applicants/${encodeURIComponent(applicationId)}?bookingSent=${Date.now()}`);
    } catch (retryRequestError) {
      setRetryError(retryRequestError instanceof Error ? retryRequestError.message : "Unable to send a new booking link.");
    } finally { setRetryBusy(false); }
  }

  // Approving needs no note; rejecting still needs a short reason (shared rule).
  async function decide(decision: "Approve" | "Reject") {
    const trimmed = comments.trim();
    if (!trimmed && decisionCommentRequired(decision)) { setError(REJECTION_REASON_REQUIRED_MESSAGE); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/applicants/${encodeURIComponent(applicationId)}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage, decision, comments: trimmed }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Unable to save decision.");
      // Show the saved state immediately while the server component refreshes.
      // This avoids a pending-looking card when the write and read hit
      // different serverless instances with separate in-memory caches.
      onSaved(decision === "Approve" ? `${title} approved.` : `${title} marked rejected.`, decision, trimmed);
      // Refresh the server component data after the workflow write so the
      // summary cards, timeline, and available decisions stay in sync without
      // losing the reviewer's current page position.
      router.refresh();
      // A same-route refresh can leave an already-rendered client boundary
      // unchanged when the page was restored from browser history. Replace
      // the detail URL as well so the approved/rejected state is guaranteed to
      // be fetched and displayed immediately after the decision succeeds.
      router.replace(`/applicants/${encodeURIComponent(applicationId)}?decisionSaved=${Date.now()}`);
      return;
    } catch (decisionError) { setError(decisionError instanceof Error ? decisionError.message : "Unable to save decision."); }
    finally { setBusy(false); }
  }

  // One click (plus a short confirmation) to send a phone or Live Avatar
  // interview. Works whether or not the resume has been screened.
  async function sendInterview(kind: "voice" | "avatar", switchType = false) {
    const name = interviewName(kind);
    const prompt = switchType
      ? { title: `Switch to a ${name}?`, message: `The current interview invitation link will stop working and the applicant will be emailed a ${name} instead.`, confirmLabel: "Switch interview" }
      : { title: `Send ${name}?`, message: `Send a ${name} to this applicant?${screened ? "" : " Resume screening will be skipped."}`, confirmLabel: "Send Interview" };
    if (!(await confirm(prompt))) return;
    setBusy(true); setError(""); setBlockedNotice(""); setSwitchOffer(null);
    try {
      const result = await postInterviewInvitation(applicationId, kind, comments.trim(), switchType);
      if (!result.ok) {
        if (result.blocked) { setBlockedNotice(result.message); if (result.canSwitch) setSwitchOffer(kind); return; }
        throw new Error(result.message);
      }
      onSaved(result.message, "Approve", comments.trim());
      router.refresh();
      router.replace(`/applicants/${encodeURIComponent(applicationId)}?interviewSent=${Date.now()}`);
    } catch (sendError) { setError(sendError instanceof Error ? sendError.message : "The interview invitation could not be sent."); }
    finally { setBusy(false); }
  }

  return <div className="applicant-decision-row">
    <div className="applicant-decision-copy">
      <div className="applicant-decision-title"><strong>{title}</strong>{current && <StatusBadge value={applicantDecisionLabel(current)} tone={isRejectedDecision(current) ? "negative" : "positive"} />}</div>
      <p>{description}</p>
      {stage === "voice" && link && <a className="applicant-booking-link" href={link} target="_blank" rel="noreferrer">Open Voice Interview Booking Link</a>}
      {stage === "voice" && retryEligible && canReview && enabled && !decided && <div className="applicant-voice-retry"><button type="button" className="btn btn-secondary" disabled={retryBusy || busy} onClick={() => void sendBookingLink()}>{retryBusy ? "Sending..." : "Send Reschedule Link"}</button><span>Creates a fresh booking link and emails it to the candidate. No call will be placed until the candidate books a new time.</span></div>}
      {retryMessage && <ActionFeedback kind="success" className="applicant-decision-success">{retryMessage}</ActionFeedback>}
      {retryError && <ValidationSummary error={retryError} title="Booking link failed" />}
      {stage === "resume" && canSendInterview && roleInterviewType !== "both" && !decided && <p className="applicant-decision-hint">This role uses {ROLE_INTERVIEW_TYPE_LABELS[roleInterviewType]}. Change it on the role page if needed.</p>}
      {stage === "resume" && canSendInterview && !screened && !decided && <p className="applicant-decision-hint">This resume hasn&apos;t been screened yet. You can skip screening and send an interview directly.</p>}
      <label className="field applicant-decision-comments" htmlFor={`${stage}-decision-comments`}><span>Note <small>(optional; required to reject)</small></span><textarea id={`${stage}-decision-comments`} value={comments} disabled={busy || !canReview || !enabled || decided} maxLength={5000} placeholder="Add a note for the history (optional)." onChange={(event) => { setComments(event.target.value); setError(""); }} /></label>
      {error && <ValidationSummary error={error} title="Decision save failed" />}
      {blockedNotice && <ActionFeedback kind="warning" className="applicant-decision-success">{blockedNotice} <a href="#applicant-screening-evidence">View interview</a>{switchOffer && <> · <button type="button" className="applicant-inline-link" disabled={busy} onClick={() => void sendInterview(switchOffer, true)}>Switch to {interviewName(switchOffer)}</button></>}</ActionFeedback>}
      {canReview && enabled && !decided && <div className="applicant-decision-actions">
        <button type="button" className="btn btn-primary" disabled={busy || (stage === "resume" && !screened)} title={stage === "resume" && !screened ? "Screening isn't finished. Send an interview directly instead." : undefined} onClick={() => void decide("Approve")}>{busy ? "Saving..." : "Approve"}</button>
        {stage === "resume" && canSendInterview && roleAllowsInterview(roleInterviewType, "voice") && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void sendInterview("voice")}>Send Phone Interview</button>}
        {stage === "resume" && canSendInterview && roleAllowsInterview(roleInterviewType, "avatar") && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void sendInterview("avatar")}>Send Avatar Interview</button>}
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void decide("Reject")}>Reject</button>
      </div>}
    </div>
  </div>;
}

export default function ApplicantDecisionPanel(props: Props) {
  const [message, setMessage] = useState("");
  const [savedDecisions, setSavedDecisions] = useState<Partial<Record<Stage, SavedDecision>>>({});
  const stage = reviewStage(props);
  const voiceBookingLink = props.interviewMode === "voice" ? props.voiceBookingLink : "";
  const voiceRetryEligible = props.interviewMode === "voice" && props.voiceRetryEligible;
  const interviewReviewTitle = props.interviewMode === "avatar"
    ? LIVE_AVATAR_REVIEW_LABEL
    : props.interviewMode === "voice" ? "Voice Interview Review" : "Interview Review";
  const saveDecision = (nextMessage: string, decision: string, comments: string) => {
    setMessage(nextMessage);
    setSavedDecisions((current) => ({ ...current, [stage]: { decision, comments } }));
  };
  const resumeDecision = savedDecisions.resume?.decision || props.resumeDecision;
  const resumeComments = savedDecisions.resume?.comments || props.resumeComments;
  const voiceDecision = savedDecisions.voice?.decision || props.voiceDecision;
  const voiceComments = savedDecisions.voice?.comments || props.voiceComments;
  const finalDecision = savedDecisions.final?.decision || props.finalInterviewStatus;
  const finalComments = savedDecisions.final?.comments || props.finalComments;
  return <section className="card applicant-decision-card"><div className="card-header"><div><h2>HR Decisions</h2><p>Review the applicant&apos;s current stage. Notes are optional, but rejecting needs a short reason.</p></div></div>{message && <ActionFeedback kind="success" className="applicant-decision-success">{message}</ActionFeedback>}<div className="applicant-decision-list">
    {stage === "resume" && props.canSendInterview && props.canReview && (props.roleInterviewType ?? DEFAULT_ROLE_INTERVIEW_TYPE) === "both" && props.currentStage.trim().toLowerCase() === "voice_booking_pending" && <InterviewTypeSwitch applicationId={props.applicationId} />}
    {stage === "resume" && (isDecided(resumeDecision) ? <CompletedDecision title="AI CV Analysis" decision={resumeDecision} comments={resumeComments} /> : <DecisionRow stage="resume" title="AI CV Analysis" description={`Review Smile's CV analysis recommendation before inviting the applicant to ${props.roleInterviewType === "voice" ? "a voice interview" : props.roleInterviewType === "avatar" ? "a Live Avatar interview" : props.interviewMode === "pending" ? "choose between a call and Live Avatar interview" : props.interviewMode === "avatar" ? "a Live Avatar interview" : "a voice interview"}.`} current={resumeDecision} applicationId={props.applicationId} canReview={props.canReview} screened={props.screened !== false} canSendInterview={props.canSendInterview === true} roleInterviewType={props.roleInterviewType} onSaved={saveDecision} />)}
    {stage === "voice" && <><CompletedDecision title="AI CV Analysis" decision={resumeDecision} comments={resumeComments} />{isDecided(voiceDecision) ? <CompletedDecision title={interviewReviewTitle} decision={voiceDecision} comments={voiceComments} link={props.finalBookingLink} /> : <DecisionRow stage="voice" title={interviewReviewTitle} description={`Review the ${props.interviewMode === "avatar" ? "Live Avatar" : props.interviewMode === "voice" ? "voice interview" : "interview"} evidence below before approving the applicant for the next stage.`} current={voiceDecision} link={voiceBookingLink} retryEligible={voiceRetryEligible} applicationId={props.applicationId} canReview={props.canReview} onSaved={saveDecision} />}</>}
    {stage === "final" && <><CompletedDecision title={interviewReviewTitle} decision={voiceDecision} comments={voiceComments} />{isDecided(props.finalStatus) || isDecided(finalDecision) ? <CompletedDecision title="Face-to-Face Interview Decision" decision={props.finalStatus || finalDecision} comments={finalComments} /> : <DecisionRow stage="final" title="Face-to-Face Interview Decision" description="Record the Face-to-Face interview outcome after the interviewer has completed the meeting." current={finalDecision === "Interview Completed" ? "" : finalDecision} enabled applicationId={props.applicationId} canReview={props.canReview} onSaved={saveDecision} />}</>}
  </div></section>;
}
