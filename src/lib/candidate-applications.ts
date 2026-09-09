import { google } from "googleapis";
import { getGoogleServiceAccountPrivateKey } from "@/lib/google-service-account";
import { bulkResumeSpreadsheetId } from "@/lib/bulk-resume-config";
import { cachedSheetsRead, freshSheetsRead, withSheetsBackoff } from "@/lib/sheets-cache";
import { demoActiveBookingLinkRoleIds, demoApplicantRows, demoInterviewBookings } from "@/lib/demo-data";
import { isDemoMode, isDemoWindowRecord } from "@/lib/demo-mode";
import { getRoleRequestById, type RoleRequestDetails } from "@/lib/google-sheets";
import { evaluationFieldsForSetup, type EvaluationField } from "@/lib/recruitment-setup-schema";
import { buildNumberedInterviewQuestions, normalizeInterviewQuestionCount } from "@/lib/interview-question-count";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { applicantStageLabel } from "@/lib/applicant-stage-labels";
import { targetActiveBookingLinkRoleIds, targetApplicantDetails, targetApplicantMetrics, targetApplicantSummaries, targetBookings, targetBulkResumeQueue, targetAppendBulkResumeQueue } from "@/lib/recruitment-target-portal";

export {
  getCandidateStatusHistory,
  syncPastAvailableInterviewSlots,
  syncPastBookedInterviewsNoShow,
  type CandidateStatusHistoryEntry,
} from "./applicant-workflow";

const spreadsheetId = process.env.GOOGLE_CANDIDATE_SPREADSHEET_ID || process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = getGoogleServiceAccountPrivateKey();

if (!spreadsheetId || !serviceAccountEmail || !privateKey) {
  throw new Error("Candidate spreadsheet access is not configured.");
}

const auth = new google.auth.JWT({
  email: serviceAccountEmail,
  key: privateKey,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

export type ApplicantSummary = {
  applicationId: string;
  candidateName: string;
  email: string;
  contactNumber: string;
  roleId: string;
  selectedRole: string;
  department: string;
  appliedAt: string;
  matchScore: string;
  recommendation: string;
  cvRecommendation: string;
  resumeStatus: string;
  voiceStatus: string;
  finalInterviewStatus: string;
  finalStatus: string;
  currentStage: string;
  nextAction: string;
  /** Generated demo history is viewable only through an explicit stage filter. */
  isHistoricalDemo?: boolean;
};

export type ApplicantDetails = ApplicantSummary & {
  roleDetails?: RoleRequestDetails;
  aiAnalysisSummary: string;
  interviewQuestions: string;
  resumeText: string;
  resumeFileId: string;
  resumeFileName: string;
  resumeFileMimeType: string;
  resumeFileExpiresAt: string;
  strengths: string;
  gaps: string;
  resumeDecision: string;
  resumeDecisionDate: string;
  resumeReviewer: string;
  resumeComments: string;
  resumeEvaluationFields: { key: string; label: string; value: string }[];
  voiceDecision: string;
  voiceComments: string;
  voiceScore: string;
  voiceRecommendation: string;
  voiceSummary: string;
  voiceStrengths: string;
  voiceConcerns: string;
  voiceCommunicationQuality: string;
  voiceAnswerCompleteness: string;
  voiceFollowUpQuestions: string;
  voiceEvaluationFields: { key: string; label: string; value: string }[];
  voiceTranscript: string;
  voiceScheduledDate: string;
  voiceScheduledTime: string;
  voiceBookingStatus: string;
  voiceBookingLink: string;
  bookingTokenStatus: string;
  bookingTokenExpiresAt: string;
  finalBookingStatus: string;
  finalScheduledDate: string;
  finalScheduledTime: string;
  finalTimezone: string;
  finalBookingLink: string;
  finalBookingTokenExpiresAt: string;
  finalComments: string;
  lastUpdated: string;
  voiceInterviewResult?: Record<string, string>;
  voiceCallLog?: Record<string, string>;
  finalInterview?: Record<string, string>;
  voiceInterviewSlot?: Record<string, string>;
  finalInterviewSlot?: Record<string, string>;
  interviewSlot?: Record<string, string>;
};

export type ApplicantMetrics = {
  total: number;
  today: number;
  screened: number;
  interviewed: number;
  voiceActivity: number;
  hrActivity: number;
  resumeApproved: number;
  voiceBookingPending: number;
  voiceScheduled: number;
  voiceReviewPending: number;
  approvedForFinal: number;
  finalScheduled: number;
  finalDecisionPending: number;
  rejected: number;
  passedFinalInterview: number;
  /** One current stage per applicant; these values always reconcile to total. */
  stageCounts: ApplicantStageCount[];
};

export type ApplicantStageCount = {
  key: string;
  label: string;
  tone: "blue" | "purple" | "green" | "teal" | "orange" | "red" | "gray";
  value: number;
};

export type InterviewBooking = {
  slotId: string;
  interviewType: string;
  roleId: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  status: string;
  applicationId: string;
  candidateName: string;
  candidateEmail: string;
  bookedAt: string;
  lastUpdated: string;
  calendarEventId: string;
  calendarEventLink: string;
  calendarEventStatus: string;
  calendarEventError: string;
};

export type BulkResumeQueueItem = {
  driveFileId: string;
  driveFileName: string;
  driveFileUrl: string;
  roleId: string;
  candidateName: string;
  candidateEmail: string;
  status: string;
  applicationId: string;
  errorMessage: string;
  discoveredAt: string;
  processingStartedAt: string;
  processedAt: string;
  attemptCount: string;
  lastUpdated: string;
  environment?: string;
  isUat?: boolean;
  batchId?: string;
  jobId?: string;
};

export type BulkResumeQueueEvent = Partial<BulkResumeQueueItem> & {
  driveFileId: string;
  driveFileMimeType?: string;
  roleId: string;
  status: string;
  resumeSha256?: string;
};

type SheetRow = Record<string, string>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeHeader(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function toRecord(headers: unknown[], row: unknown[]): SheetRow {
  return Object.fromEntries(headers.map((header, index) => {
    const key = normalizeHeader(header);
    return [key, text(row[index])];
  }).filter(([key]) => Boolean(key)));
}

function field(record: SheetRow, ...names: string[]) {
  for (const name of names) {
    const key = normalizeHeader(name);
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return "";
}

function configuredEvaluationValues(
  fields: EvaluationField[],
  result: SheetRow | undefined,
  fallback: SheetRow | undefined,
) {
  // Optional evaluation fields are only useful in the evidence panel when a
  // workflow actually supplied a value. Returning placeholder strings here
  // made every missing field look like a failed log entry.
  return fields
    .filter((configured) => !["score", "recommendation", "strengths", "concerns"].includes(configured.key))
    .flatMap((configured) => {
      const value = field(result || {}, configured.key, configured.label)
        || field(fallback || {}, configured.key, configured.label);
      return value ? [{ key: configured.key, label: configured.label, value }] : [];
    });
}

async function readTab(tabName: string, endColumn: string, options: { fresh?: boolean; spreadsheetId?: string } = {}): Promise<{ headers: string[]; rows: SheetRow[] }> {
  const escapedTabName = tabName.replace(/'/g, "''");
  const targetSpreadsheetId = options.spreadsheetId || spreadsheetId;
  const fetchValues = async () => {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: targetSpreadsheetId,
      // Google Sheets rejects mixed open-ended ranges such as A1:R. Use
      // whole-column notation so newly appended queue rows are included.
      range: `'${escapedTabName}'!A:${endColumn}`,
    });
    return response.data.values ?? [];
  };
  // Applicant decisions are written by one serverless request and the detail
  // page is often rendered by another. A process-local cache invalidation in
  // the write request cannot reach that second instance, so detail reads must
  // bypass the short-lived cache and show the decision that was just saved.
  const values = options.fresh
    ? await freshSheetsRead(fetchValues)
    : await cachedSheetsRead(`${tabName}:${endColumn}:${targetSpreadsheetId}`, fetchValues);
  const headers = (values[0] ?? []).map((value) => text(value));
  const rows = values.slice(1)
    .filter((row) => row.some((value) => text(value) !== ""))
    .map((row) => toRecord(headers, row));
  return { headers, rows };
}

function applicationId(record: SheetRow) {
  return field(record, "Application_ID", "Application ID");
}

/** Keep legacy sheet/status keys intact while presenting the candidate-friendly label. */
function displayFaceToFaceInterviewText(value: string) {
  return value.replace(/final[- ]interview/gi, "Face-to-Face Interview");
}

/** Present one canonical label when older rows used the AI-prefixed wording. */
function displayInterviewStageText(value: string) {
  return value
    .replace(/\bAI Voice Interview Completed\s*-\s*(?:Awaiting HR Review|For HR Review)\b/gi, "Voice Interview Completed - For HR Review")
    .replace(/\bAI Voice Interview Completed\b/gi, "Voice Interview Completed");
}

function stageFor(record: SheetRow) {
  const stages = [
    field(record, "Final_Status"),
    field(record, "Status 3 (Final Interview)"),
    field(record, "Status 2 (Voice Interview)"),
    field(record, "Status (Resume Processing)"),
  ];
  // New rows carry Pending placeholders for later interview stages. Do not
  // let those defaults hide the completed resume handoff from HR.
  // New or unprocessed applications are waiting for the first HR review; do
  // not expose a separate "Submitted" bucket in the applicant pipeline.
  const stage = stages.find((value) => !["", "pending", "not started", "submitted"].includes(value.trim().toLowerCase())) || "Pending HR Review";
  const normalizedStage = ["processed", "for hr review"].includes(stage.trim().toLowerCase()) ? "Pending HR Review" : stage;
  return displayInterviewStageText(normalizedStage);
}

function nextActionFor(record: SheetRow) {
  const finalStatus = field(record, "Final_Status").toLowerCase();
  const voiceStatus = field(record, "Status 2 (Voice Interview)").toLowerCase();
  const voiceDecision = field(record, "Voice_HR_Decision").toLowerCase();
  const finalInterviewStatus = field(record, "Status 3 (Final Interview)").toLowerCase();

  if (voiceStatus.includes("retry scheduled") || finalStatus.includes("retry scheduled")) return "Awaiting AI Call Retry";
  if (voiceStatus.includes("no show") || finalStatus.includes("voice interview no show")) return "Reschedule Voice Interview";
  if (finalInterviewStatus.includes("no show") || finalStatus.includes("final interview no show")) return "Reschedule Face-to-Face Interview";
  if (finalStatus.includes("approved for ai voice") || voiceStatus === "awaiting schedule") return "Schedule Voice Interview";
  if (["calling", "initiated", "in progress"].includes(voiceStatus)) return "Voice Interview In Progress";
  if (voiceStatus === "scheduled" || finalStatus.includes("voice interview scheduled")) return "Complete Voice Interview";
  // Attendance is complete before HR makes the pass/reject decision.
  if (["interviewed", "completed"].includes(voiceStatus) && ["pending", ""].includes(voiceDecision)) return "Review Voice Interview";
  const finalStagePending = finalInterviewStatus.includes("awaiting schedule") || finalInterviewStatus.includes("not started") || finalInterviewStatus.includes("pending");
  if (!finalStagePending && (finalInterviewStatus.includes("scheduled") || finalInterviewStatus.includes("booked") || finalStatus.includes("final interview scheduled"))) return "Attend Face-to-Face Interview";
  if (finalStatus.includes("approved for final") || finalInterviewStatus === "awaiting schedule") return "Schedule Face-to-Face Interview";
  return "Review Application";
}

function workflowRecommendationFor(record: SheetRow) {
  const currentStage = stageFor(record);
  const normalizedStage = currentStage.toLowerCase();
  const finalStatus = field(record, "Final_Status").toLowerCase();
  const voiceStatus = field(record, "Status 2 (Voice Interview)").toLowerCase();
  const voiceDecision = field(record, "Voice_HR_Decision").toLowerCase();
  const finalInterviewStatus = field(record, "Status 3 (Final Interview)").toLowerCase();

  if (voiceStatus.includes("retry scheduled") || finalStatus.includes("retry scheduled")) return "AI Voice Interview Retry Scheduled";
  if (voiceStatus.includes("no show") || finalStatus.includes("voice interview no show")) return "AI Voice Interview No Show";
  if (finalInterviewStatus.includes("no show") || finalStatus.includes("final interview no show")) return "Face-to-Face Interview No Show";
  if (["calling", "initiated", "in progress"].includes(voiceStatus) || finalStatus.includes("voice interview in progress")) {
    return "AI Voice Interview In Progress";
  }

  // Nothing about the final interview is meaningful until the voice stage is
  // decided. "Status 3 (Final Interview)" starts at "Pending" on every new
  // applicant, which the final-stage branch below reads as "awaiting
  // scheduling" — so a candidate whose voice call had not happened yet was
  // reported as waiting on a final interview. Report the voice stage instead
  // while it is still open; approved and rejected candidates fall through to
  // the final-interview wording as before.
  if (!["approve", "reject"].includes(voiceDecision)) {
    if (voiceStatus === "scheduled") return "AI Voice Interview Scheduled";
    if (voiceStatus === "awaiting schedule" || finalStatus.includes("approved for ai voice")) return "Awaiting AI Voice Interview Schedule";
    if (["interviewed", "completed"].includes(voiceStatus)) return "Voice Interview Awaiting HR Review";
  }

  const finalStagePending = finalInterviewStatus.includes("awaiting schedule") || finalInterviewStatus.includes("not started") || finalInterviewStatus.includes("pending");
  if (!finalStagePending && (finalInterviewStatus.includes("scheduled") || finalInterviewStatus.includes("booked") || finalStatus.includes("final interview scheduled"))) {
    return "Face-to-Face Interview Scheduled";
  }

  if (finalStagePending || finalStatus.includes("final interview booking link sent") || finalStatus.includes("approved for final")) {
    return "Awaiting Face-to-Face Interview Scheduling";
  }

  // The summary recommendation must reflect the applicant's current workflow
  // stage. The original CV recommendation is kept separately for the CV panel.
  if (currentStage && currentStage !== "Submitted" && normalizedStage !== "processed") {
    return currentStage;
  }

  return field(record, "Recommendation") || "Pending HR Review";
}

function hasFinalInterviewOutcome(record: SheetRow) {
  const finalStatus = field(record, "Final_Status").toLowerCase();
  const finalInterviewStatus = field(record, "Status 3 (Final Interview)").toLowerCase();
  return [finalStatus, finalInterviewStatus].some((value) =>
    /(final interview (passed|rejected)|interview (completed|passed|rejected)|hired|not selected)/i.test(value),
  );
}

const applicantStageDefinitions: Omit<ApplicantStageCount, "value">[] = [
  { key: "resume_review", label: applicantStageLabel("resume_review"), tone: "blue" },
  { key: "resume_approved", label: applicantStageLabel("resume_approved"), tone: "blue" },
  { key: "voice_booking_pending", label: applicantStageLabel("voice_booking_pending"), tone: "purple" },
  { key: "voice_scheduled", label: applicantStageLabel("voice_scheduled"), tone: "purple" },
  { key: "voice_review_pending", label: applicantStageLabel("voice_review_pending"), tone: "green" },
  { key: "approved_for_final", label: applicantStageLabel("approved_for_final"), tone: "teal" },
  { key: "final_scheduled", label: applicantStageLabel("final_scheduled"), tone: "orange" },
  { key: "final_decision_pending", label: applicantStageLabel("final_decision_pending"), tone: "orange" },
  { key: "passed_final", label: applicantStageLabel("passed_final"), tone: "green" },
  { key: "rejected", label: applicantStageLabel("rejected"), tone: "red" },
];

function currentApplicantStage(record: SheetRow) {
  const finalStatus = field(record, "Final_Status").toLowerCase();
  const resumeStatus = field(record, "Status (Resume Processing)").toLowerCase();
  const resumeDecision = field(record, "Resume_HR_Decision").toLowerCase();
  const voiceStatus = field(record, "Status 2 (Voice Interview)").toLowerCase();
  const voiceDecision = field(record, "Voice_HR_Decision").toLowerCase();
  const finalInterviewStatus = field(record, "Status 3 (Final Interview)").toLowerCase();

  // Resolve the latest workflow stage first so stale earlier decisions cannot
  // make one applicant appear in multiple terminal buckets.
  if (finalStatus.includes("passed final") || finalStatus.includes("hired") || finalInterviewStatus.includes("passed final") || finalInterviewStatus === "passed") return "passed_final";
  // A few legacy rows used the short `Rejected` value instead of a
  // stage-qualified status. Check this after a passed outcome so a stale
  // rejection cannot override the later HR decision.
  if (finalStatus === "rejected" || finalInterviewStatus === "rejected" || finalStatus.includes("final interview rejected") || finalInterviewStatus.includes("final interview rejected")) return "rejected";
  if (finalInterviewStatus === "interview completed" || finalStatus.includes("final interview completed")) return "final_decision_pending";
  if (finalInterviewStatus.includes("scheduled") || finalStatus.includes("final interview scheduled")) return "final_scheduled";
  if (finalStatus.includes("approved for final") || finalStatus.includes("final interview booking link sent") || finalInterviewStatus.includes("awaiting schedule")) return "approved_for_final";
  if (voiceDecision.includes("reject") || finalStatus.includes("voice interview rejected")) return "rejected";
  if (voiceStatus === "interviewed" || voiceStatus === "completed") {
    if (voiceDecision === "approve") return "approved_for_final";
    if (voiceDecision === "pending" || voiceDecision === "") return "voice_review_pending";
  }
  if (voiceStatus === "scheduled" || finalStatus.includes("voice interview scheduled")) return "voice_scheduled";
  if (finalStatus.includes("approved for ai voice") || voiceStatus === "awaiting schedule") return "voice_booking_pending";
  if (resumeDecision.includes("reject") || finalStatus.includes("resume rejected")) return "rejected";
  if (resumeDecision === "approve") return "resume_approved";
  if (["processed", "for hr review", "pending hr review"].includes(resumeStatus) || finalStatus.includes("pending hr review")) return "resume_review";
  // Keep new rows in the reconciled pipeline without introducing a separate
  // Submitted stage that would duplicate the initial HR review queue.
  return "resume_review";
}

function applyFinalBookingState(summary: ApplicantSummary, record: SheetRow, finalSlot?: SheetRow) {
  if (field(finalSlot ?? {}, "Status").toLowerCase() !== "booked" || hasFinalInterviewOutcome(record)) return summary;

  // A booked final slot is the source of truth for scheduling. This protects
  // the profile from stale tracking rows that contain an outcome such as
  // "Passed" before the final interview has happened.
  return {
    ...summary,
    recommendation: "Face-to-Face Interview Scheduled",
    finalInterviewStatus: "Interview Scheduled",
    finalStatus: "Face-to-Face Interview Scheduled",
    currentStage: "Face-to-Face Interview Scheduled",
    nextAction: "Attend Face-to-Face Interview",
  };
}

function mapApplicant(record: SheetRow, isHistoricalDemo = false): ApplicantSummary {
  const finalStatus = field(record, "Final_Status");
  const voiceStatus = field(record, "Status 2 (Voice Interview)");
  const finalInterviewStatus = field(record, "Status 3 (Final Interview)");
  // Demo and bulk-import rows can carry a generated application date that is
  // ahead of the portal's local calendar date. Keep the source sheet intact,
  // but never present an applicant as applied in the future in the UI.
  const rawAppliedAt = field(
    record,
    "Date_of_Application",
    "Date of Application",
    "Applied_At",
    "Applied At",
    "Created_At",
    "Created At",
    "Submitted_At",
    "Submitted At",
  );
  const appliedAt = clampFutureApplicationDate(rawAppliedAt);
  return {
    applicationId: applicationId(record),
    candidateName: field(record, "Candidate_Name", "Candidate Name", "Name"),
    email: field(record, "Email", "Candidate_Email"),
    contactNumber: field(record, "Contact_Number", "Contact Number", "Phone"),
    roleId: field(record, "Role_ID", "Role ID"),
    selectedRole: field(record, "Selected_Role", "Selected Role", "Role"),
    department: field(record, "Department"),
    appliedAt,
    matchScore: field(record, "Match_Score", "Match Score"),
    recommendation: displayFaceToFaceInterviewText(displayInterviewStageText(workflowRecommendationFor(record))),
    cvRecommendation: field(record, "Recommendation"),
    resumeStatus: field(record, "Status (Resume Processing)"),
    voiceStatus,
    finalInterviewStatus: displayFaceToFaceInterviewText(displayInterviewStageText(finalInterviewStatus)),
    finalStatus: displayFaceToFaceInterviewText(displayInterviewStageText(finalStatus)),
    currentStage: displayFaceToFaceInterviewText(displayInterviewStageText(stageFor(record))),
    nextAction: displayFaceToFaceInterviewText(displayInterviewStageText(nextActionFor(record))),
    isHistoricalDemo,
  };
}

function clampFutureApplicationDate(value: string, timeZone = process.env.PORTAL_TIMEZONE || "Asia/Singapore") {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const formatDate = (date: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const appliedDate = formatDate(parsed);
  const today = formatDate(new Date());
  return appliedDate > today ? today : value;
}

function calendarDate(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function calculateApplicantMetrics(rows: SheetRow[], now = new Date(), timeZone = process.env.PORTAL_TIMEZONE || "Asia/Singapore"): ApplicantMetrics {
  const today = calendarDate(now.toISOString(), timeZone);
  const stageCounts = applicantStageDefinitions.map((stage) => ({ ...stage, value: 0 }));
  return rows.reduce<ApplicantMetrics>((result, record) => {
    const resumeStatus = field(record, "Status (Resume Processing)").toLowerCase();
    const voiceStatus = field(record, "Status 2 (Voice Interview)").toLowerCase();
    const stage = currentApplicantStage(record);

    result.total += 1;
    if (calendarDate(field(record, "Date_of_Application", "Date of Application"), timeZone) === today) result.today += 1;
    // Treat every completed resume handoff as screened, including the
    // normalized HR-review label used by the bulk and public workflows.
    if (["processed", "for hr review", "pending hr review"].includes(resumeStatus)) result.screened += 1;
    if (voiceStatus === "interviewed" || voiceStatus === "completed") result.interviewed += 1;
    if (voiceStatus !== "" && !["pending", "not started"].includes(voiceStatus)) result.voiceActivity += 1;
    const finalInterviewStatus = field(record, "Status 3 (Final Interview)").toLowerCase();
    if (finalInterviewStatus !== "" && !["pending", "not started"].includes(finalInterviewStatus)) result.hrActivity += 1;
    const stageCount = result.stageCounts.find((entry) => entry.key === stage);
    if (stageCount) stageCount.value += 1;
    if (stage === "resume_approved") result.resumeApproved += 1;
    if (stage === "voice_booking_pending") result.voiceBookingPending += 1;
    if (stage === "voice_scheduled") result.voiceScheduled += 1;
    if (stage === "voice_review_pending") result.voiceReviewPending += 1;
    if (stage === "approved_for_final") result.approvedForFinal += 1;
    if (stage === "final_scheduled") result.finalScheduled += 1;
    if (stage === "final_decision_pending") result.finalDecisionPending += 1;
    if (stage === "rejected") result.rejected += 1;
    if (stage === "passed_final") result.passedFinalInterview += 1;
    return result;
  }, { total: 0, today: 0, screened: 0, interviewed: 0, voiceActivity: 0, hrActivity: 0, resumeApproved: 0, voiceBookingPending: 0, voiceScheduled: 0, voiceReviewPending: 0, approvedForFinal: 0, finalScheduled: 0, finalDecisionPending: 0, rejected: 0, passedFinalInterview: 0, stageCounts });
}

/**
 * Restore the generated historical cohort for demo metrics. The cohort is
 * synthetic by design, but its stage distribution gives the dashboard a
 * realistic, long-running recruitment history while live August 20+ records
 * continue to be included in the totals.
 */
function withDemoHistory(rows: SheetRow[]): SheetRow[] {
  if (!isDemoMode()) return rows;
  const recentLive = rows.filter((row) => isDemoWindowRecord(field(
    row,
    "Date_of_Application",
    "Date of Application",
    "Applied_At",
    "Applied At",
    "Created_At",
    "Created At",
    "Submitted_At",
    "Submitted At",
  )));
  return [...demoApplicantRows(), ...recentLive];
}

/**
 * Keep the client-demo Applicants page focused on actionable records: bulk
 * uploads and live test applications from August 20, 2026 onward. Generated
 * historical rows stay available to dashboard metrics, but remain hidden from
 * this operational list so a demo user only sees records they can explain.
 */
function withDemoApplicantList(rows: SheetRow[]): SheetRow[] {
  if (!isDemoMode()) return rows;
  return rows.filter((row) => {
    const id = applicationId(row);
    // Public/n8n submissions use a timestamped APP id. Keep those real test
    // records visible even when their submitted timestamp predates a demo
    // cutoff, while still hiding generated YYYYMMDD-sequence history rows.
    if (/^APP-(?:BULK-|\d{13}-[A-Z0-9]{6})/i.test(id)) return true;
    return isDemoWindowRecord(field(
      row,
      "Date_of_Application",
      "Date of Application",
      "Applied_At",
      "Applied At",
      "Created_At",
      "Created At",
      "Submitted_At",
      "Submitted At",
    ));
  });
}

function withDemoBookings(bookings: InterviewBooking[]): InterviewBooking[] {
  if (!isDemoMode()) return bookings;
  const recentLive = bookings.filter((booking) => isDemoWindowRecord(`${booking.date}T${booking.startTime}:00`));
  return [...demoInterviewBookings(), ...recentLive];
}

/**
 * Guards destructive profile edits while demo mode is on. Internal review
 * decisions are intentionally allowed so new test applicants can complete the
 * workflow; booking and contact actions have their own downstream guards.
 */
export async function demoActionBlockReason(targetApplicationId: string): Promise<string | null> {
  // The active recruitment target stores applicants in Postgres. The demo
  // guard below intentionally reads the legacy Sheets snapshot, which makes
  // every target-mode edit/delete look like a missing applicant.
  if (isPostgresRecruitmentTarget()) return null;
  if (!isDemoMode()) return null;
  const normalizedId = text(targetApplicationId).toLowerCase();
  const { rows } = await readTab("High_Match_Profile", "CZ");
  const applicant = rows.find((row) => applicationId(row).toLowerCase() === normalizedId);
  if (!applicant) return "Applicant record was not found.";
  const appliedAt = field(
    applicant,
    "Date_of_Application",
    "Date of Application",
    "Applied_At",
    "Applied At",
    "Created_At",
    "Created At",
    "Submitted_At",
    "Submitted At",
  );
  return isDemoWindowRecord(appliedAt)
    ? null
    : "This historical applicant is read-only. Records from August 20, 2026 onward can be edited normally.";
}

export async function getApplicants(): Promise<ApplicantSummary[]> {
  if (isPostgresRecruitmentTarget()) return targetApplicantSummaries();
  // No-show maintenance runs in the background. Keep the Applicants page
  // focused on reading the data it needs to render.
  // Same cross-instance staleness this codebase already works around for the
  // detail page (see readTab's fresh option above): a create/update/delete
  // request and the router.refresh() that follows it can land on different
  // serverless instances, so the process-local cache here can still be
  // serving a pre-mutation snapshot. This is the primary applicant list, so
  // bypass the cache rather than risk showing a just-deleted or just-edited
  // record as unchanged.
  const live = (await readTab("High_Match_Profile", "CZ", { fresh: true })).rows;
  const operational = withDemoApplicantList(live).map((record) => mapApplicant(record));
  // Keep generated history out of the default table, but provide it to the
  // client so an explicit dashboard-stage filter can show read-only examples.
  const historical = isDemoMode() ? demoApplicantRows().map((record) => mapApplicant(record, true)) : [];
  return [...operational, ...historical]
    .filter((applicant) => applicant.applicationId !== "")
    .sort((left, right) => Date.parse(right.appliedAt) - Date.parse(left.appliedAt));
}

export async function getApplicantMetrics(): Promise<ApplicantMetrics> {
  if (isPostgresRecruitmentTarget()) return targetApplicantMetrics() as Promise<ApplicantMetrics>;
  // The scheduled interview maintenance handles past no-show updates. Keep
  // dashboard metrics read-only so the dashboard does not wait on that work.
  const rows = withDemoHistory((await readTab("High_Match_Profile", "CZ")).rows);
  return calculateApplicantMetrics(rows.filter((record) => applicationId(record) !== ""));
}

export async function getInterviewBookings(): Promise<InterviewBooking[]> {
  if (isPostgresRecruitmentTarget()) return targetBookings();
  // Maintenance runs from the server background task. Keep this read-only so
  // the Bookings page is not blocked by several reconciliation sheet reads
  // and writes before it can render.
  const { rows } = await readTab("Interview_Slots", "X");
  const live = rows.map((record) => ({
    slotId: field(record, "Slot_ID", "Slot ID"),
    interviewType: field(record, "Interview_Type", "Interview Type"),
    roleId: field(record, "Role_ID", "Role ID"),
    date: field(record, "Date"),
    startTime: field(record, "Start_Time", "Start Time"),
    endTime: field(record, "End_Time", "End Time"),
    timezone: field(record, "Timezone", "Time Zone"),
    status: field(record, "Status").toLowerCase() === "available" && (() => { const date = field(record, "Date"); const time = field(record, "Start_Time", "Start Time"); const parsed = Date.parse(`${date}T${time || "00:00"}:00`); return Number.isFinite(parsed) && parsed <= Date.now(); })() ? "Expired" : field(record, "Status"),
    applicationId: field(record, "Application_ID", "Application ID"),
    candidateName: field(record, "Candidate_Name", "Candidate Name"),
    candidateEmail: field(record, "Candidate_Email", "Candidate Email"),
    bookedAt: field(record, "Booked_At", "Booked At"),
    lastUpdated: field(record, "Last_Updated", "Last Updated"),
    calendarEventId: field(record, "Google_Calendar_Event_ID"),
    calendarEventLink: field(record, "Google_Calendar_Event_Link"),
    calendarEventStatus: field(record, "Google_Calendar_Event_Status"),
    calendarEventError: field(record, "Google_Calendar_Event_Error"),
  })).filter((booking) => booking.slotId).sort((left, right) => `${left.date} ${left.startTime}`.localeCompare(`${right.date} ${right.startTime}`));
  return withDemoBookings(live);
}

function hasActiveBookingLink(record: SheetRow, kind: "voice" | "final") {
  const token = kind === "voice"
    ? field(record, "Booking_Token") || field(record, "Booking_Token_Hash")
    : field(record, "Final_Interview_Booking_Token") || field(record, "Final_Interview_Booking_Token_Hash");
  if (!token) return false;
  const status = (kind === "voice"
    ? field(record, "Booking_Token_Status")
    : field(record, "Final_Interview_Booking_Token_Status")).toLowerCase();
  if (["used", "booked", "expired", "revoked"].includes(status)) return false;
  const expiresAt = kind === "voice"
    ? field(record, "Booking_Token_Expires_At")
    : field(record, "Final_Interview_Booking_Token_Expires_At");
  const expiryTime = Date.parse(expiresAt);
  return !expiresAt || !Number.isFinite(expiryTime) || expiryTime >= Date.now();
}

/**
 * Candidate booking links are tracked separately from the admin calendar's
 * generated availability. Persisted bookings are still returned separately so
 * completed appointments remain visible even when a link has expired.
 */
export async function getActiveBookingLinkRoleIds() {
  if (isPostgresRecruitmentTarget()) return targetActiveBookingLinkRoleIds();
  const { rows } = await readTab("High_Match_Profile", "CZ");
  const voice = new Set<string>();
  const final = new Set<string>();
  rows.forEach((record) => {
    if (isDemoMode() && !isDemoWindowRecord(field(
      record,
      "Date_of_Application",
      "Date of Application",
      "Applied_At",
      "Applied At",
      "Created_At",
      "Created At",
      "Submitted_At",
      "Submitted At",
    ))) return;
    const roleId = field(record, "Role_ID", "Role ID").trim().toLowerCase();
    if (!roleId) return;
    if (hasActiveBookingLink(record, "voice")) voice.add(roleId);
    if (hasActiveBookingLink(record, "final")) final.add(roleId);
  });
  if (isDemoMode()) {
    const demoIds = demoActiveBookingLinkRoleIds().map((roleId) => roleId.toLowerCase());
    return {
      voice: [...new Set([...demoIds, ...voice])],
      final: [...new Set([...demoIds, ...final])],
    };
  }
  return { voice: [...voice], final: [...final] };
}

export async function getBulkResumeQueue(roleId = "", options: { fresh?: boolean } = {}): Promise<BulkResumeQueueItem[]> {
  if (isPostgresRecruitmentTarget()) return targetBulkResumeQueue(roleId);
  const { rows } = await readTab("Bulk_Resume_Queue", "U", { ...options, spreadsheetId: bulkResumeSpreadsheetId() });
  const normalizedRoleId = roleId.trim().toLowerCase();
  const latestByFile = new Map<string, BulkResumeQueueItem>();
  const eventTimestamp = (item: BulkResumeQueueItem) => {
    const timestamp = Date.parse(item.lastUpdated || item.processedAt || item.processingStartedAt || item.discoveredAt);
    return Number.isFinite(timestamp) ? timestamp : 0;
  };
  rows
    .map((record) => ({
      driveFileId: field(record, "Drive_File_ID", "Drive File ID", "driveFileId"),
      driveFileName: field(record, "Drive_File_Name", "Drive File Name", "driveFileName"),
      driveFileUrl: field(record, "Drive_File_URL", "Drive File URL", "driveFileUrl"),
      roleId: field(record, "Role_ID", "Role ID", "roleId"),
      candidateName: field(record, "Candidate_Name", "Candidate Name", "candidateName"),
      candidateEmail: field(record, "Candidate_Email", "Candidate Email", "candidateEmail"),
      status: field(record, "Status"),
      applicationId: field(record, "Application_ID", "Application ID", "applicationId"),
      errorMessage: field(record, "Error_Message", "Error Message", "errorMessage"),
      discoveredAt: field(record, "Discovered_At", "Discovered At", "discoveredAt"),
      processingStartedAt: field(record, "Processing_Started_At", "Processing Started At", "processingStartedAt"),
      processedAt: field(record, "Processed_At", "Processed At", "processedAt"),
      attemptCount: field(record, "Attempt_Count", "Attempt Count", "attemptCount"),
      lastUpdated: field(record, "Last_Updated", "Last Updated", "lastUpdated"),
      environment: field(record, "Environment", "environment"),
      isUat: ["true", "1", "yes"].includes(field(record, "Is_UAT", "Is UAT", "is_uat").toLowerCase()),
      batchId: field(record, "Batch_ID", "Batch ID", "batchId"),
      jobId: field(record, "Job_ID", "Job ID", "jobId"),
    }))
    .filter((item) => item.driveFileId && (!normalizedRoleId || item.roleId.toLowerCase() === normalizedRoleId))
    .forEach((item) => {
      const identity = `${item.roleId.toLowerCase()}|${item.driveFileId.toLowerCase()}`;
      const previous = latestByFile.get(identity);
      const itemTime = eventTimestamp(item);
      const previousTime = previous ? eventTimestamp(previous) : Number.NEGATIVE_INFINITY;
      // Queue rows are append-only events. Prefer the most recently timestamped
      // event so a reordered or manually edited sheet cannot make a Screened
      // resume look Queued and send it through AI again.
      if (!previous || (Number.isFinite(itemTime) && (!Number.isFinite(previousTime) || itemTime >= previousTime))) {
        latestByFile.set(identity, item);
      }
    });
  return [...latestByFile.values()].sort((left, right) => eventTimestamp(right) - eventTimestamp(left));
}

// Google Sheets' append() picks "the next empty row" per request; two calls
// landing close together can both target the same row and one silently
// overwrites the other. The bulk upload route appends one event per file
// through a concurrent worker pool, so without this lock a batch upload --
// the normal case, not an edge case -- can lose queue rows with no error
// anywhere. Serializing writes to this tab in-process closes that race for a
// single app instance; a multi-instance deployment would need a shared lock.
const bulkQueueEventLocks = new Map<string, Promise<void>>();
let nextBulkQueueWriteAt = 0;

async function waitForBulkQueueWriteSlot() {
  const startAt = Math.max(Date.now(), nextBulkQueueWriteAt);
  nextBulkQueueWriteAt = startAt + 1_200;
  const delay = startAt - Date.now();
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

async function withBulkQueueEventLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = bulkQueueEventLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  bulkQueueEventLocks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (bulkQueueEventLocks.get(key) === queued) bulkQueueEventLocks.delete(key);
  }
}

/**
 * Save an intake event before downstream screening starts. This makes every
 * uploaded file visible even when text extraction or an external handoff
 * fails before the downstream process can write its own result.
 */
export async function appendBulkResumeQueueEvent(event: BulkResumeQueueEvent) {
  if (isPostgresRecruitmentTarget()) {
    return targetAppendBulkResumeQueue(event);
  }
  const targetSpreadsheetId = bulkResumeSpreadsheetId();
  return withBulkQueueEventLock(`bulk-resume-queue:${targetSpreadsheetId}`, async () => {
    // Headers are structural metadata, not live queue state. Reuse the short
    // cache here so a 15-file upload does not spend one Sheets read per event
    // before n8n has even started screening.
    const { headers } = await readTab("Bulk_Resume_Queue", "U", { spreadsheetId: targetSpreadsheetId });
    if (!headers.length) throw new Error("The Bulk_Resume_Queue tab has no header row.");
    const values = headers.map((header) => {
      const key = normalizeHeader(header);
      const aliases: Record<string, unknown> = {
        drive_file_id: event.driveFileId,
        drive_file_name: event.driveFileName,
        drive_file_url: event.driveFileUrl,
        drive_file_mime_type: (event as BulkResumeQueueEvent & { driveFileMimeType?: string }).driveFileMimeType,
        role_id: event.roleId,
        candidate_name: event.candidateName,
        candidate_email: event.candidateEmail,
        status: event.status,
        application_id: event.applicationId,
        error_message: event.errorMessage,
        discovered_at: event.discoveredAt,
        processing_started_at: event.processingStartedAt,
        processed_at: event.processedAt,
        attempt_count: event.attemptCount,
        last_updated: event.lastUpdated,
        environment: event.environment,
        is_uat: event.isUat,
        batch_id: event.batchId,
        job_id: event.jobId,
      };
      return aliases[key] === undefined ? "" : aliases[key];
    });
    await waitForBulkQueueWriteSlot();
    await withSheetsBackoff(() => sheets.spreadsheets.values.append({
      spreadsheetId: targetSpreadsheetId,
      range: "'Bulk_Resume_Queue'!A:U",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [values] },
    }));
  });
}

/** Count every saved queue event for the selected role, including retries. */
export async function getBulkResumeQueueTotals(roleId = "", options: { fresh?: boolean } = {}) {
  if (isPostgresRecruitmentTarget()) {
    const items = await targetBulkResumeQueue(roleId);
    return items.reduce<Record<string, number>>((counts, item) => {
      const status = ["Screened", "Failed", "Skipped", "Processing", "Queued"].includes(item.status) ? item.status : "Queued";
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
  }
  const { rows } = await readTab("Bulk_Resume_Queue", "U", { ...options, spreadsheetId: bulkResumeSpreadsheetId() });
  const normalizedRoleId = roleId.trim().toLowerCase();
  const events = rows.map((record) => {
    const rowRoleId = field(record, "Role_ID", "Role ID", "roleId").toLowerCase();
    const rawStatus = field(record, "Status").toLowerCase();
    const status = rawStatus === "screened" || rawStatus === "processed" ? "Screened" : rawStatus === "failed" ? "Failed" : rawStatus === "skipped" ? "Skipped" : rawStatus === "processing" ? "Processing" : "Queued";
    const identity = `${rowRoleId}|${field(record, "Drive_File_ID", "Drive File ID", "driveFileId").toLowerCase()}`;
    const timestamp = Date.parse(field(record, "Last_Updated", "Last Updated", "lastUpdated", "Processed_At", "Processed At", "processedAt", "Discovered_At", "Discovered At", "discoveredAt")) || 0;
    return { rowRoleId, status, identity, timestamp };
  }).filter((event) => !normalizedRoleId || event.rowRoleId === normalizedRoleId);
  const latestByIdentity = new Map<string, { status: string; timestamp: number }>();
  for (const event of events) {
    const previous = latestByIdentity.get(event.identity);
    if (!previous || event.timestamp >= previous.timestamp) latestByIdentity.set(event.identity, { status: event.status, timestamp: event.timestamp });
  }
  return events.reduce<Record<string, number>>((counts, event) => {
    const terminal = ["Screened", "Failed", "Skipped"].includes(event.status);
    const latest = latestByIdentity.get(event.identity);
    // Processing/Queued is a current state, while terminal rows are kept as
    // historical attempts. This prevents the initial Processing row from
    // inflating a completed count, without losing repeated failures.
    if (terminal || (latest?.status === event.status && latest.timestamp === event.timestamp)) counts[event.status] = (counts[event.status] || 0) + 1;
    return counts;
  }, {});
}

/**
 * Return queue identities for which the candidate sheet contains the minimum
 * persisted AI-screening result. The queue's Screened event is written by n8n
 * after the screening workflow responds, but this second check protects the
 * portal from showing a false completion if that workflow or its sheet write
 * is only partially successful. Matching remains backward-compatible with
 * historical rows that predate jobId metadata.
 */
function bulkQueueKey(item: Pick<BulkResumeQueueItem, "roleId" | "driveFileId">) {
  return `${text(item.roleId).toLowerCase()}|${text(item.driveFileId).toLowerCase()}`;
}

function normalizedFileName(value: unknown) {
  return text(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function queueResumeSha(item: BulkResumeQueueItem) {
  const explicit = text((item as BulkResumeQueueItem & { resumeSha256?: string }).resumeSha256);
  if (explicit) return explicit.toLowerCase();
  const match = text(item.driveFileId).match(/^BULK-[A-Z0-9_-]+-([a-f0-9]{64})$/i);
  return match?.[1]?.toLowerCase() || "";
}

function applicantHasScreeningEvidence(record: SheetRow) {
  const resumeStatus = field(record, "Status (Resume Processing)").toLowerCase();
  return ["processed", "for hr review", "pending hr review"].includes(resumeStatus)
    && Boolean(field(record, "Recommendation"));
}

function applicantRoleMatches(item: BulkResumeQueueItem, record: SheetRow) {
  const queueRole = text(item.roleId).toLowerCase();
  const applicantRole = field(record, "Role_ID", "Role ID").toLowerCase();
  return !queueRole || !applicantRole || queueRole === applicantRole;
}

/**
 * Match queue events to persisted applicant screening evidence. New rows use
 * jobId/applicationId; older rows often only have the Drive file ID or name.
 * Strong identifiers are accepted directly, while filename/name fallbacks are
 * accepted only when they identify one role-scoped applicant.
 */
export async function getBulkResumeScreeningEvidence(queueItems: BulkResumeQueueItem[]): Promise<Set<string>> {
  if (queueItems.length === 0) return new Set();
  if (isPostgresRecruitmentTarget()) {
    const applicationIds = queueItems.map((item) => item.applicationId).filter(Boolean);
    const { listScreening } = await import("@/lib/internal-recruitment-queries");
    const rows = await Promise.all(applicationIds.map((applicationId) => listScreening(applicationId)));
    const evidence = new Set<string>();
    rows.forEach((results, index) => { if (results.length > 0) evidence.add(bulkQueueKey(queueItems[index])); });
    return evidence;
  }
  const { rows } = await readTab("High_Match_Profile", "CZ", { fresh: true, spreadsheetId: bulkResumeSpreadsheetId() });
  const evidenceRows = rows.filter(applicantHasScreeningEvidence);
  const index = (valueFor: (record: SheetRow) => string) => {
    const result = new Map<string, SheetRow[]>();
    for (const record of evidenceRows) {
      const value = valueFor(record).toLowerCase();
      if (!value) continue;
      result.set(value, [...(result.get(value) || []), record]);
    }
    return result;
  };
  const byJobId = index((record) => field(record, "Job_ID", "Job ID", "jobId"));
  const byApplicationId = index(applicationId);
  const byResumeSha = index((record) => field(record, "Resume_File_SHA256", "Resume File SHA256", "resumeFileSha256"));
  const byDriveFileId = index((record) => field(record, "Resume_File_ID", "Resume File ID", "resumeFileId"));
  const byRoleAndFileName = index((record) => `${field(record, "Role_ID", "Role ID").toLowerCase()}|${normalizedFileName(field(record, "Resume_File_Name", "Resume File Name", "resumeFileName"))}`);
  const byRoleAndEmail = index((record) => `${field(record, "Role_ID", "Role ID").toLowerCase()}|${field(record, "Candidate_Email", "Candidate Email", "Email").toLowerCase()}`);
  const byRoleAndName = index((record) => `${field(record, "Role_ID", "Role ID").toLowerCase()}|${normalizedFileName(field(record, "Candidate_Name", "Candidate Name", "Name"))}`);

  const strongMatch = (lookup: Map<string, SheetRow[]>, key: string, item: BulkResumeQueueItem) => {
    const matches = (lookup.get(key.toLowerCase()) || []).filter((record) => applicantRoleMatches(item, record));
    return matches[0];
  };
  const uniqueMatch = (lookup: Map<string, SheetRow[]>, key: string, item: BulkResumeQueueItem) => {
    const matches = (lookup.get(key.toLowerCase()) || []).filter((record) => applicantRoleMatches(item, record));
    return matches.length === 1 ? matches[0] : undefined;
  };

  const matched = new Set<string>();
  for (const item of queueItems) {
    const role = text(item.roleId).toLowerCase();
    const fileName = normalizedFileName(item.driveFileName);
    const email = text(item.candidateEmail).toLowerCase();
    const name = normalizedFileName(item.candidateName);
    const sha = queueResumeSha(item);
    const result =
      strongMatch(byJobId, item.jobId || "", item)
      || strongMatch(byApplicationId, item.applicationId, item)
      || uniqueMatch(byResumeSha, sha, item)
      || uniqueMatch(byDriveFileId, item.driveFileId, item)
      || uniqueMatch(byRoleAndFileName, `${role}|${fileName}`, item)
      || uniqueMatch(byRoleAndEmail, `${role}|${email}`, item)
      || uniqueMatch(byRoleAndName, `${role}|${name}`, item);
    if (result) matched.add(bulkQueueKey(item));
  }
  return matched;
}

export async function getApplicantById(id: string): Promise<ApplicantDetails | null> {
  if (isPostgresRecruitmentTarget()) return targetApplicantDetails(id) as Promise<ApplicantDetails | null>;
  const [{ rows: applicantRows }, { rows: voiceResults }, { rows: callLogs }, { rows: finalInterviews }, { rows: slots }] = await Promise.all([
    readTab("High_Match_Profile", "CZ", { fresh: true }),
    readTab("Voice_Interview_Results", "AF"),
    readTab("Voice_Call_Logs", "AD"),
    readTab("Final_Interview_Tracking", "AE"),
    readTab("Interview_Slots", "X"),
  ]);
  const normalizedId = text(id).toLowerCase();
  const liveRecord = applicantRows.find((row) => applicationId(row).toLowerCase() === normalizedId);
  // The Applicants list deliberately mixes persisted applications with the
  // generated historical demo cohort. Resolve the same generated row here so
  // every visible View link has a matching, read-only profile instead of
  // falling through to "Applicant Not Found".
  const demoRecord = isDemoMode()
    ? demoApplicantRows().find((row) => applicationId(row).toLowerCase() === normalizedId)
    : undefined;
  const record = liveRecord || demoRecord;
  if (!record) return null;
  const isGeneratedDemoRecord = !liveRecord && Boolean(demoRecord);

  const summary = mapApplicant(record);
  // A retry creates a new result/log row for the same applicant. Always use
  // the most recent event; selecting the first row can surface an older
  // no-answer result instead of the completed retry with its transcript.
  const latestRelated = (rows: SheetRow[], timestampFields: string[]) => rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => applicationId(row).toLowerCase() === normalizedId)
    .sort((left, right) => {
      const timestamp = (row: SheetRow) => timestampFields
        .map((fieldName) => field(row, fieldName))
        .map((value) => Date.parse(value))
        .find((value) => !Number.isNaN(value)) ?? Number.NEGATIVE_INFINITY;
      return timestamp(right.row) - timestamp(left.row) || right.index - left.index;
    })
    .at(0)?.row;
  const voiceResult = latestRelated(voiceResults, ["Result_Received_At", "Call_Completed_At", "Last_Updated", "Created_At"]);
  const callLog = latestRelated(callLogs, ["Result_Received_At", "Call_Completed_At", "Last_Updated", "Date"]);
  const finalInterview = latestRelated(finalInterviews, ["Last_Updated", "Booked_At", "Created_At"]);
  const generatedDemoSlots: SheetRow[] = isGeneratedDemoRecord
    ? demoInterviewBookings()
      .filter((booking) => booking.applicationId.toLowerCase() === normalizedId)
      .map((booking) => ({
        slot_id: booking.slotId,
        interview_type: booking.interviewType,
        role_id: booking.roleId,
        date: booking.date,
        start_time: booking.startTime,
        end_time: booking.endTime,
        timezone: booking.timezone,
        status: booking.status,
        application_id: booking.applicationId,
        candidate_name: booking.candidateName,
        candidate_email: booking.candidateEmail,
        booked_at: booking.bookedAt,
        last_updated: booking.lastUpdated,
        google_calendar_event_id: booking.calendarEventId,
        google_calendar_event_link: booking.calendarEventLink,
        google_calendar_event_status: booking.calendarEventStatus,
        google_calendar_event_error: booking.calendarEventError,
      }))
    : [];
  const applicantSlots = (isGeneratedDemoRecord ? generatedDemoSlots : slots)
    .filter((row) => applicationId(row).toLowerCase() === normalizedId);
  const voiceInterviewSlot = applicantSlots.find((row) => field(row, "Interview_Type", "Interview Type").toLowerCase().includes("voice"));
  const finalInterviewSlot = applicantSlots.find((row) => field(row, "Interview_Type", "Interview Type").toLowerCase().includes("final"));
  const interviewSlot = voiceInterviewSlot || applicantSlots[0];
  const displaySummary = applyFinalBookingState(summary, record, finalInterviewSlot);
  const role = !isGeneratedDemoRecord && (field(record, "Voice_HR_Decision").toLowerCase() === "approve" || voiceResult || callLog)
    ? await getRoleRequestById(summary.roleId)
    : null;
  const configuredEvaluationFields = evaluationFieldsForSetup(role?.evaluationFieldToggles, role?.customEvaluationFields);
  const voiceSummary = normalizeInterviewQuestionCount(
    field(voiceResult ?? {}, "AI_Voice_Summary", "AI Voice Summary")
      || field(callLog ?? {}, "AI_Voice_Summary", "AI Voice Summary")
      || (isGeneratedDemoRecord && summary.voiceStatus ? "Historical voice interview activity is represented by the status and outcome recorded for this demonstration applicant." : ""),
  );
  const voiceAnswerCompleteness = normalizeInterviewQuestionCount(
    field(voiceResult ?? {}, "Answer_Completeness", "Answer Completeness")
      || field(callLog ?? {}, "Answer_Completeness", "Answer Completeness"),
  );

  return {
    ...displaySummary,
    roleDetails: role || undefined,
    aiAnalysisSummary: field(record, "AI_Analysis_Summary", "AI Analysis Summary")
      || (isGeneratedDemoRecord ? `The CV was reviewed against the ${summary.selectedRole} requirements. The match score and recommendation shown above summarize the historical screening result.` : ""),
    // Show HR the same canonical numbered list Ella was driven by (from the
    // role's current setup), not a stale per-applicant snapshot, so the
    // question numbers in the AI summary line up with what HR sees.
    interviewQuestions: buildNumberedInterviewQuestions([
      role?.requiredInterviewQuestion1, role?.requiredInterviewQuestion2, role?.requiredInterviewQuestion3,
      role?.requiredInterviewQuestion4, role?.requiredInterviewQuestion5,
    ]).join("\n")
      || field(record, "Interview_Questions", "Interview Questions")
      || (isGeneratedDemoRecord ? `Q1: Describe the experience most relevant to the ${summary.selectedRole} role.\nQ2: How would you approach the role's main responsibilities during your first 90 days?\nQ3: What strengths would you bring to the team?` : ""),
    resumeText: field(record, "Resume_Text", "Resume_CV", "Resume/CV", "Resume Text")
      || (isGeneratedDemoRecord ? "Historical demonstration record. The original CV file is not stored for generated applicants." : ""),
    resumeFileId: field(record, "Resume_File_Id"),
    resumeFileName: field(record, "Resume_File_Name"),
    resumeFileMimeType: field(record, "Resume_File_Mime_Type"),
    resumeFileExpiresAt: field(record, "Resume_File_Expires_At"),
    strengths: field(record, "Strengths") || (isGeneratedDemoRecord ? "Relevant transferable experience and role-aligned capabilities." : ""),
    gaps: field(record, "Gaps") || (isGeneratedDemoRecord ? "Specific examples and technical depth should be confirmed during the interview." : ""),
    resumeDecision: field(record, "Resume_HR_Decision"),
    resumeDecisionDate: field(record, "Resume_HR_Decision_Date"),
    resumeReviewer: field(record, "Resume_HR_Reviewer"),
    resumeComments: field(record, "Resume_HR_Comments"),
    resumeEvaluationFields: configuredEvaluationValues(configuredEvaluationFields, record, undefined),
    voiceDecision: field(record, "Voice_HR_Decision"),
    voiceComments: field(record, "Voice_HR_Comments"),
    // Voice_Interview_Results is canonical. The call log is a safe fallback
    // while the result workflow is retrying or when a provider webhook only
    // updated the audit log.
    voiceScore: field(voiceResult ?? {}, "Voice_Score", "Voice Score") || field(callLog ?? {}, "Voice_Score", "Voice Score")
      || (isGeneratedDemoRecord && summary.voiceStatus ? summary.matchScore : ""),
    voiceRecommendation: field(voiceResult ?? {}, "Voice_Recommendation", "Voice Recommendation") || field(callLog ?? {}, "Voice_Recommendation", "Voice Recommendation")
      || (isGeneratedDemoRecord && summary.voiceStatus ? summary.recommendation : ""),
    voiceSummary,
    voiceStrengths: field(voiceResult ?? {}, "Voice_Strengths", "Voice Strengths") || field(callLog ?? {}, "Voice_Strengths", "Voice Strengths")
      || (isGeneratedDemoRecord && summary.voiceStatus ? "Clear responses and relevant examples." : ""),
    voiceConcerns: field(voiceResult ?? {}, "Voice_Concerns", "Voice Concerns") || field(callLog ?? {}, "Voice_Concerns", "Voice Concerns")
      || (isGeneratedDemoRecord && summary.voiceStatus ? "Role-specific details should be validated by HR." : ""),
    voiceCommunicationQuality: field(voiceResult ?? {}, "Communication_Quality", "Communication Quality") || field(callLog ?? {}, "Communication_Quality", "Communication Quality"),
    voiceAnswerCompleteness,
    voiceFollowUpQuestions: field(voiceResult ?? {}, "Recommended_Follow_Up_Questions", "Recommended Follow Up Questions") || field(callLog ?? {}, "Recommended_Follow_Up_Questions", "Recommended Follow Up Questions"),
    // Communication Quality and Answer Completeness have dedicated voice
    // evidence rows above; do not render those same keys a second time from
    // the role's optional evaluation-field configuration.
    voiceEvaluationFields: configuredEvaluationValues(configuredEvaluationFields, voiceResult, callLog)
      .filter((evaluation) => !["communication_quality", "answer_completeness"].includes(evaluation.key)),
    voiceTranscript: field(voiceResult ?? {}, "Transcript", "Voice_Transcript", "Call_Transcript") || field(callLog ?? {}, "Transcript", "Voice_Transcript", "Call_Transcript"),
    voiceScheduledDate: field(record, "Voice_Interview_Scheduled_Date"),
    voiceScheduledTime: field(record, "Voice_Interview_Scheduled_Time"),
    voiceBookingStatus: field(record, "Voice_Interview_Booking_Status"),
    voiceBookingLink: field(record, "Voice_Interview_Booking_Link"),
    bookingTokenStatus: field(record, "Booking_Token_Status"),
    bookingTokenExpiresAt: field(record, "Booking_Token_Expires_At"),
    finalBookingStatus: field(record, "Final_Interview_Booking_Token_Status"),
    finalScheduledDate: field(record, "Final_Interview_Scheduled_Date"),
    finalScheduledTime: field(record, "Final_Interview_Scheduled_Time"),
    finalTimezone: field(record, "Final_Interview_Timezone"),
    finalBookingLink: field(record, "Final_Interview_Booking_Link"),
    finalBookingTokenExpiresAt: field(record, "Final_Interview_Booking_Token_Expires_At"),
    finalComments: field(record, "Final_Interview_Comments", "Final Interview Comments"),
    lastUpdated: field(record, "Last_Updated") || finalInterviewSlot?.last_updated || voiceInterviewSlot?.last_updated || summary.appliedAt,
    voiceInterviewResult: voiceResult,
    voiceCallLog: callLog,
    finalInterview,
    voiceInterviewSlot,
    finalInterviewSlot,
    interviewSlot,
  };
}

export function applicantStageClass(stage: string) {
  return `applicant-stage applicant-stage-${stage.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
