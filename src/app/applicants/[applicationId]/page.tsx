import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import ApplicantDetailActions from "@/components/ApplicantDetailActions";
import ApplicantDecisionPanel from "@/components/ApplicantDecisionPanel";
import ApplicantLiveRefresh from "@/components/ApplicantLiveRefresh";
import UiIcon, { type UiIconName } from "@/components/UiIcon";
import { canDecideApplicant, canEditApplicant, canViewApplicant } from "@/lib/access-control";
import {
  applicantStageClass,
  getApplicantById,
  getCandidateStatusHistory,
  type ApplicantDetails,
  type CandidateStatusHistoryEntry,
} from "@/lib/candidate-applications";
import type { RoleRequestDetails } from "@/lib/google-sheets";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { formatMatchScore } from "@/lib/score-format";
import { formatPortalClock, formatPortalDateTime } from "@/lib/portal-time";
import { applicantDecisionLabel, applicantStageLabel } from "@/lib/applicant-stage-labels";
import { parseTextList } from "@/lib/formatters";

export const dynamic = "force-dynamic";

const TERMINAL_APPLICANT_STAGES = new Set(["passed_final", "rejected", "withdrawn"]);

function dateValue(value: string) {
  return formatPortalDateTime(value, true);
}

function scheduledValue(date: string, time: string) {
  const parts = [date ? formatPortalDateTime(date, false) : "", formatPortalClock(time)].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Not scheduled";
}

function recordValue(record: Record<string, string> | undefined, ...keys: string[]) {
  if (!record) return "";
  for (const key of keys) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (record[normalized]) return record[normalized];
  }
  return "";
}

function externalUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function latestDecisionComment(history: CandidateStatusHistoryEntry[], stage: CandidateStatusHistoryEntry["stage"]) {
  return history.find((entry) => entry.stage === stage && entry.comments.trim())?.comments || "";
}

function questionItems(value: string) {
  // Accepts a JSON array (the AI screening format), or bullet / numbered text.
  // Strip any remaining "Q1:" label so the list renders with its own numbering.
  return parseTextList(value).map((line) => line.replace(/^\s*Q\s*\d+\s*[:.)-]?\s*/i, "").trim()).filter(Boolean);
}

// Render a stored list value (JSON array or bulleted text) as a readable list.
// A single item renders as a paragraph so short values stay compact.
function ReadableList({ value, empty }: { value: string; empty: string }) {
  const items = parseTextList(value);
  if (items.length === 0) return <p>{empty}</p>;
  if (items.length === 1) return <p>{items[0]}</p>;
  return <ul className="applicant-readable-list">{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>;
}

function DetailField({ label, value, className = "" }: { label: string; value?: string; className?: string }) {
  if (!value) return null;
  return <div className={`applicant-detail-field ${className}`.trim()}><span>{label}</span><strong>{value}</strong></div>;
}

function DetailCardHeader({ icon, title, description }: { icon: UiIconName; title: string; description?: string }) {
  return <div className="card-header applicant-section-header"><div className="applicant-section-heading"><span className="applicant-section-icon"><UiIcon name={icon} size={17} /></span><div><h2>{title}</h2>{description && <p>{description}</p>}</div></div></div>;
}

function FinalInterviewCard({ applicant, role }: { applicant: ApplicantDetails; role: RoleRequestDetails | null }) {
  const finalInterview = applicant.finalInterview;
  const slot = applicant.finalInterviewSlot;
  const status = applicant.finalInterviewStatus || recordValue(finalInterview, "Final_Interview_Status", "Status") || "Not Started";
  const statusLower = status.toLowerCase();
  const slotStatus = recordValue(slot, "Status").toLowerCase();
  const isScheduled = slotStatus === "booked" || (!/(awaiting schedule|not started|pending)/i.test(statusLower) && /(scheduled|booked)/i.test(statusLower));
  const bookingStatus = slot ? recordValue(slot, "Status") || (isScheduled ? "Booked" : "Not Booked") : isScheduled ? applicant.finalBookingStatus || "Booked" : "Not Booked";
  const scheduledDate = recordValue(slot, "Date") || (isScheduled ? applicant.finalScheduledDate || recordValue(finalInterview, "Final_Interview_Date", "Date") : "");
  const scheduledTime = recordValue(slot, "Start_Time", "Start Time", "Time") || (isScheduled ? applicant.finalScheduledTime : "");
  const timezone = recordValue(slot, "Timezone", "Time Zone") || (isScheduled ? applicant.finalTimezone : "");
  const slotInterviewerName = recordValue(slot, "Interviewer_Name", "Interviewer Name") || recordValue(slot, "HOD_Name", "HOD Name");
  const slotInterviewerEmail = recordValue(slot, "Interviewer_Email", "Interviewer Email") || recordValue(slot, "HOD_Email", "HOD Email");
  const hrName = slotInterviewerName || (role?.hodEmail ? "HR" : "");
  const hrEmail = slotInterviewerEmail || role?.hodEmail || "";
  const interviewer = hrName
    ? [hrName, hrEmail && hrEmail !== hrName ? hrEmail : ""].filter(Boolean).join(" · ")
    : recordValue(finalInterview, "Interviewer_Name", "Interviewer Name") || "Not assigned";
  const storedRecommendation = recordValue(finalInterview, "Final_Recommendation", "Final Recommendation");
  const finalOutcomeSource = [applicant.finalStatus, applicant.finalInterviewStatus, status].join(" ");
  const hasFinalOutcome = /(?:(?:final|hr) interview (passed|rejected)|interview (completed|passed|rejected)|hired|not selected)/i.test(finalOutcomeSource);
  const recommendation = hasFinalOutcome && storedRecommendation
    ? storedRecommendation
    : isScheduled
      ? "Face-to-Face Interview Scheduled"
      : "Awaiting Face-to-Face Interview Scheduling";
  const displayedStatus = isScheduled && /(awaiting schedule|not started|pending)/i.test(statusLower)
    ? "Interview Scheduled"
    : applicantStageLabel(status);
  const calendarStatus = recordValue(slot, "Google_Calendar_Event_Status");
  const calendarError = recordValue(slot, "Google_Calendar_Event_Error");

  return <section className="card applicant-detail-card applicant-final-interview-card">
    <DetailCardHeader icon="briefcase" title="Face-to-Face Interview" description="Schedule and interview outcome details." />
    <div className="applicant-detail-content">
      <div className="applicant-detail-inline-fields">
        <DetailField label="Applicant" value={applicant.candidateName} />
        <DetailField label="Role" value={applicant.selectedRole} />
        <DetailField label="Status" value={displayedStatus} />
        <DetailField label="Booking Status" value={bookingStatus} />
        <DetailField label="Scheduled" value={scheduledValue(scheduledDate, scheduledTime)} />
        <DetailField label="Timezone" value={timezone || "Not provided"} />
        <DetailField label="Interviewer" value={interviewer} className="applicant-final-interviewer-field" />
        <DetailField label="Recommendation" value={recommendation} />
        {calendarStatus && <DetailField label="Calendar" value={calendarStatus} />}
      </div>
      {calendarError && <p className="applicant-voice-review-hint">Calendar sync note: {calendarError}</p>}
    </div>
  </section>;
}

function CombinedScreeningEvidence({ applicant }: { applicant: ApplicantDetails }) {
  const voiceCallStatus = applicant.voiceCallStatus?.trim() || "";
  const voiceBookingLink = externalUrl(applicant.voiceBookingLink);
  const voiceNotConducted = /no answer|no[- ]?show|incomplete|not connected|voicemail|busy|declined|cancell?ed/i.test(voiceCallStatus);
  const voiceScorePending = voiceNotConducted ? "Not evaluated — no completed interview" : "Awaiting AI evaluation";
  return <section className="card applicant-detail-card applicant-screening-evidence-card">
    <DetailCardHeader icon="document" title="AI Screening Evidence" description="CV analysis and voice interview evidence for one complete HR review." />
    <div className="applicant-detail-content">
      <div className="applicant-evidence-subsection">
        <div className="applicant-evidence-subsection-heading"><UiIcon name="document" size={16} /><h3>AI CV Analysis</h3></div>
        <div className="applicant-detail-inline-fields">
          <DetailField label="CV Analysis Status" value={applicantDecisionLabel(applicant.resumeStatus)} />
          <DetailField label="CV Recommendation" value={applicant.cvRecommendation || "Not Provided"} />
          <DetailField label="HR Decision" value={applicantDecisionLabel(applicant.resumeDecision)} />
          <DetailField label="Reviewed By" value={applicant.resumeReviewer} />
        </div>
        <div className="applicant-copy-block"><span>AI Analysis Summary</span><p>{applicant.aiAnalysisSummary || "No AI summary is available."}</p></div>
        <div className="applicant-copy-columns"><div><span>Strengths</span><ReadableList value={applicant.strengths} empty="Not provided." /></div><div><span>Gaps</span><ReadableList value={applicant.gaps} empty="Not provided." /></div></div>
        {applicant.resumeEvaluationFields.length > 0 && <div className="applicant-copy-columns">{applicant.resumeEvaluationFields.map((evaluation) => <div key={`resume-${evaluation.key}`}><span>{evaluation.label}</span><p>{evaluation.value}</p></div>)}</div>}
      </div>
      <div className="applicant-evidence-subsection">
        <div className="applicant-evidence-subsection-heading"><UiIcon name="microphone" size={16} /><h3>Voice Interview Review</h3></div>
        <div className="applicant-detail-inline-fields">
          <DetailField label="Status" value={applicantStageLabel(voiceCallStatus) || applicantStageLabel(applicant.voiceStatus) || "Not Started"} />
          <DetailField label="Booking Status" value={applicant.voiceBookingStatus || "Not Booked"} />
          <DetailField label="Scheduled" value={scheduledValue(applicant.voiceScheduledDate, applicant.voiceScheduledTime)} />
          <DetailField label="Timezone" value={recordValue(applicant.interviewSlot, "Timezone", "Time Zone") || applicant.voiceTimezone || "Not provided"} />
          <DetailField label="Voice AI Score" value={applicant.voiceScore ? formatMatchScore(applicant.voiceScore) : voiceScorePending} />
          <DetailField label="AI Recommendation" value={applicant.voiceRecommendation || voiceScorePending} />
        </div>
        {voiceBookingLink && <div className="applicant-copy-block"><span>Candidate booking page</span><p><Link href={voiceBookingLink} target="_blank" rel="noreferrer">Open the candidate booking page</Link></p></div>}
        <div className="applicant-copy-block"><span>AI Summary</span><p>{applicant.voiceSummary || (voiceNotConducted ? "No interview took place, so there is no AI summary." : "No AI summary is available.")}</p></div>
        <div className="applicant-copy-columns"><div><span>Strengths</span><ReadableList value={applicant.voiceStrengths} empty="No strengths recorded." /></div><div><span>Concerns</span><ReadableList value={applicant.voiceConcerns} empty="No concerns recorded." /></div></div>
        <div className="applicant-copy-columns"><div><span>Communication Quality</span><p>{applicant.voiceCommunicationQuality || "Not provided."}</p></div><div><span>Answer Completeness</span><p>{applicant.voiceAnswerCompleteness || "Not provided."}</p></div></div>
        {applicant.voiceEvaluationFields.length > 0 && <div className="applicant-copy-columns">{applicant.voiceEvaluationFields.map((evaluation) => <div key={evaluation.key}><span>{evaluation.label}</span><p>{evaluation.value}</p></div>)}</div>}
        <div className="applicant-copy-block"><span>Recommended Follow-up Questions</span><ReadableList value={applicant.voiceFollowUpQuestions} empty="No follow-up questions were recommended." /></div>
        {applicant.voiceTranscript ? <details className="applicant-transcript"><summary>View full transcript</summary><pre>{applicant.voiceTranscript}</pre></details> : <div className="applicant-copy-block"><span>Transcript</span><p>No transcript is available.</p></div>}
      </div>
    </div>
  </section>;
}

function ResumeResource({ value }: { value: string; fileId?: string; fileName?: string; expiresAt?: string }) {
  // Keep the original inline resume view. File metadata remains available to
  // the backend, but applicant details should show extracted text only.
  const resumeText = value.trim() && !externalUrl(value) ? value : "No resume or CV text is available.";
  return <pre className="applicant-resume">{resumeText}</pre>;
}

function InterviewQuestions({ value }: { value: string }) {
  const items = questionItems(value);
  if (items.length === 0) return <div className="applicant-empty-content"><UiIcon name="document" size={20} /><span>No interview questions are available.</span></div>;
  return <ol className="applicant-question-list">{items.map((question, index) => <li key={`${question}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{question}</p></li>)}</ol>;
}

function HistoryTimeline({ history }: { history: CandidateStatusHistoryEntry[] }) {
  if (history.length === 0) {
    return <section className="card applicant-detail-card history-card"><div className="card-header applicant-section-header"><div className="applicant-section-heading"><span className="applicant-section-icon"><UiIcon name="clock" size={17} /></span><div><h2>Candidate Status History</h2><p>Review the candidate audit trail.</p></div></div></div><div className="empty">No candidate status history is available.</div></section>;
  }

  return <section className="card applicant-detail-card history-card"><div className="card-header applicant-section-header"><div className="applicant-section-heading"><span className="applicant-section-icon"><UiIcon name="clock" size={17} /></span><div><h2>Candidate Status History</h2><p>Review the candidate audit trail.</p></div></div></div><div className="history-timeline">{history.map((entry, index) => <article className="timeline-entry" key={`${entry.historyId || entry.changedAt}-${index}`}><span className="timeline-marker" aria-hidden="true" /><div className="timeline-content"><div className="timeline-top"><div><h3>{entry.previousStatus ? `${applicantStageLabel(entry.previousStatus)} → ${applicantStageLabel(entry.newStatus)}` : applicantStageLabel(entry.newStatus) || entry.action}</h3><span className="timeline-action">{applicantStageLabel(entry.stage)} · {entry.action}</span></div><time dateTime={entry.changedAt}>{dateValue(entry.changedAt)}</time></div><div className="timeline-performer"><strong>{entry.changedByName}</strong><span>{entry.changedByEmail}</span></div><div className="timeline-meta">{[entry.roleId, entry.actionSource].filter(Boolean).join(" · ")}</div>{entry.comments && <p className="timeline-comments">{entry.comments}</p>}{entry.rejectionReason && <div className="history-entry-comments"><span>Rejection reason</span><p>{entry.rejectionReason}</p></div>}</div></article>)}</div></section>;
}

export default async function ApplicantDetailsPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");
  if (user.canReviewRole !== true && user.canApproveRole !== true && user.canReviewDepartmentRole !== true) redirect("/dashboard");

  const applicationId = decodeURIComponent((await params).applicationId);
  const [applicant, history] = await Promise.all([getApplicantById(applicationId), getCandidateStatusHistory(applicationId)]);
  // A department-scoped (HOD-tier) account outside this applicant's
  // department gets the same "not found" response as a missing record,
  // rather than a 403 that would confirm the record exists elsewhere.
  if (!applicant || !canViewApplicant(user, applicant)) return <AppShell user={user}><main className="container page"><section className="card"><div className="empty"><p>Applicant Not Found.</p><Link className="btn btn-secondary" href="/applicants">Back to Applicants</Link></div></section></main></AppShell>;
  const role = applicant.voiceDecision.toLowerCase() === "approve" ? applicant.roleDetails || null : null;
  const resumeComments = applicant.resumeComments || latestDecisionComment(history, "resume");
  const voiceComments = applicant.voiceComments || latestDecisionComment(history, "voice");
  const finalComments = applicant.finalComments || latestDecisionComment(history, "final");

  return <AppShell user={user}><main className="container page applicant-details-page">
    <ApplicantLiveRefresh enabled={!TERMINAL_APPLICANT_STAGES.has(applicant.currentStage.trim().toLowerCase())} intervalMs={applicant.currentStage.trim().toLowerCase() === "voice_scheduled" ? 30_000 : undefined} />
    <header className="applicant-detail-header"><Link href="/applicants" className="portal-back-link applicant-back-link"><UiIcon name="arrow-left" size={15} />Back to Applicants</Link><div className="applicant-detail-title-row"><div><span className="eyebrow-dark">APPLICANT PROFILE</span><h1>{applicant.candidateName || "Unnamed Candidate"}</h1><p>{applicant.applicationId} · {applicant.email || "No Email Provided"}</p></div><span className={applicantStageClass(applicant.currentStage)}>{applicantStageLabel(applicant.currentStage)}</span></div><div className="applicant-detail-actions"><Link className="btn btn-secondary" href={`/roles/${encodeURIComponent(applicant.roleId)}`}><UiIcon name="briefcase" size={15} />View Role</Link><Link className="btn btn-secondary" href={`/roles/${encodeURIComponent(applicant.roleId)}/applicants`}><UiIcon name="applicants" size={15} />Role Applicants</Link><ApplicantDetailActions applicationId={applicant.applicationId} candidateName={applicant.candidateName} canManage={canEditApplicant(user)} /></div></header>
    <div className="applicant-detail-summary"><DetailField label="Selected Role" value={applicant.selectedRole} /><DetailField label="Department" value={applicant.department} /><DetailField label="Applied" value={dateValue(applicant.appliedAt)} /><DetailField label="Match Score" value={formatMatchScore(applicant.matchScore)} /><DetailField label="Recommendation" value={applicant.recommendation} /><DetailField label="Next Action" value={applicant.nextAction} /></div>
    <div className="applicant-detail-grid"><div className="applicant-detail-main">
      <CombinedScreeningEvidence applicant={applicant} />
      <ApplicantDecisionPanel applicationId={applicant.applicationId} currentStage={applicant.currentStage} resumeDecision={applicant.resumeDecision} resumeComments={resumeComments} voiceDecision={applicant.voiceDecision} voiceComments={voiceComments} voiceStatus={applicant.voiceCallStatus || applicant.voiceStatus} finalInterviewStatus={applicant.finalInterviewStatus} finalStatus={applicant.finalStatus} finalComments={finalComments} finalBookingLink={applicant.finalBookingLink} canReview={canDecideApplicant(user)} />
      <section className="card applicant-detail-card"><DetailCardHeader icon="document" title="Resume / CV" description="The candidate's submitted resume document." /><ResumeResource value={applicant.resumeText} fileId={applicant.resumeFileId} fileName={applicant.resumeFileName} expiresAt={applicant.resumeFileExpiresAt} /></section>
      <section className="card applicant-detail-card"><DetailCardHeader icon="microphone" title="Interview Questions" description="Questions prepared for the candidate's interview." /><InterviewQuestions value={applicant.interviewQuestions} /></section>
      <HistoryTimeline history={history} />
    </div><aside className="applicant-detail-side">
      {applicant.voiceDecision.toLowerCase() === "approve" && <FinalInterviewCard applicant={applicant} role={role} />}
      <section className="card applicant-detail-card"><DetailCardHeader icon="clock" title="Status Tracking" description="Current progress through the candidate workflow." /><div className="applicant-timeline"><div><strong>1. AI CV Analysis</strong><span>{applicantDecisionLabel(applicant.resumeStatus) || "Not Started"}</span></div><div><strong>2. Voice Interview</strong><span>{applicantStageLabel(applicant.voiceCallStatus || applicant.voiceStatus) || "Not Started"}</span></div><div><strong>3. Voice HR Review</strong><span>{applicantDecisionLabel(applicant.voiceDecision) || "Pending"}</span></div><div><strong>4. Face-to-Face Interview</strong><span>{applicantStageLabel(applicant.finalInterviewStatus) || "Not Started"}</span></div><div><strong>Last Updated</strong><span>{dateValue(applicant.lastUpdated)}</span></div></div></section>
    </aside></div>
  </main></AppShell>;
}
