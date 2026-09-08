import crypto from "node:crypto";
import { google } from "googleapis";
import { getGoogleServiceAccountPrivateKey } from "@/lib/google-service-account";
import { z } from "zod";

import { createFinalInterviewEvent, deleteFinalInterviewEvent, checkCalendarAvailability, getCalendarBusyWindows, type CalendarAvailabilityResult } from "@/lib/google-calendar";
import { getFinalInterviewCalendarConfig, getRoleRequestById } from "@/lib/google-sheets";
import { expandHodAvailabilitySlots, parseHodAvailabilitySlots, slotMatchesHodAvailability } from "@/lib/hod-availability";
import { isValidTimezone, scheduledInstant } from "@/lib/interview-time";
import { bookingLink } from "@/lib/public-url";
import { isDemoSideEffectAllowed } from "@/lib/demo-mode";
import { assertCreditsAvailable, EllaCreditsError } from "@/lib/ella-credits";
import { getPortalConfigNumber } from "@/lib/portal-config";
import { cachedSheetsRead, invalidateSheetsCache } from "@/lib/sheets-cache";
import type { ResumeFileRecord } from "@/lib/resume-files";
import { generateAutomaticVoiceInterviewSlots, type VoiceInterviewSlot } from "@/lib/voice-interview-availability";
import { normalizeDateOnly, normalizeTimeOnly } from "@/lib/date-only";
import { countActiveVoiceInterviews, isActiveVoiceInterviewStatus, MAX_CONCURRENT_VOICE_INTERVIEWS, voiceCapacitySlotId, voiceInterviewConcurrencyKey } from "@/lib/voice-interview-capacity";
import { hasValidFutureTime, isBeforeTargetHiringDate, isCurrentCalendarMonth, isStandardFinalInterviewSlot, isStandardVoiceInterviewSlot, isVirtualSlotId, slotKey, virtualSlotsForRole } from "@/lib/interview-availability-rules";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { targetBookingContext, targetCreateInterviewSlot, targetRecordApplicantDecision, targetReserveBooking, targetUpdateApplicantProfile } from "@/lib/recruitment-target-portal";
import { listApplicationHistory } from "@/lib/internal-recruitment-queries";

export type BookingKind = "voice" | "final";
export type ApplicantDecisionStage = "resume" | "voice" | "final";
export type ApplicantDecision = "Approve" | "Reject" | "Manual Review" | "No Show";
export type ApplicantHistoryAction = ApplicantDecision | "Completed";
export type CandidateApplicationSource =
  | "Direct Application"
  | "Referral"
  | "Walk-in"
  | "Agency"
  | "Existing Database"
  | "HR Invitation";

export type CandidateApplicationInput = {
  roleId: string;
  candidateName: string;
  email: string;
  phone: string;
  preferredMobile: string;
  applicantCountry: string;
  resumeText: string;
  salaryExpectation: string;
  noticePeriod: string;
  availability: string;
  skillsAssessment: string;
  roleExpectations: string;
  applicationSource: CandidateApplicationSource | string;
  resumeFile?: ResumeFileRecord;
};

export type CandidateApplicationWebhookPayload = {
  eventType: "candidate_application_submitted";
  applicationId: string;
  roleId: string;
  Role_ID: string;
  jobTitle: string;
  department: string;
  // The same role-level evaluation contract is used by resume screening and
  // the post-call voice evaluator. Keeping it on the application event means
  // the screening workflow does not need to reconstruct it from a sheet row.
  evaluationFields: { key: string; label: string; description: string }[];
  candidate: {
    name: string;
    email: string;
    phone: string;
    preferredMobile: string;
    applicantCountry: string;
    resumeText: string;
    salaryExpectation: string;
    noticePeriod: string;
    availability: string;
    skillsAssessment: string;
    roleExpectations: string;
    applicationSource: string;
    consent?: boolean;
  };
  submittedAt: string;
  source: string;
  applicationSource: string;
  resumeFile?: Pick<ResumeFileRecord, "fileId" | "fileName" | "mimeType" | "size" | "sha256" | "uploadedAt" | "expiresAt" | "kind">;
};

export const candidateApplicationSources = [
  "Direct Application",
  "Referral",
  "Walk-in",
  "Agency",
  "Existing Database",
  "HR Invitation",
] as const;

export const candidateApplicationSubmissionSchema = z.object({
  roleId: z.string().trim().min(1).max(200),
  candidateName: z.string().trim().min(2).max(150),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(50).default(""),
  preferredMobile: z.string().trim().min(1).max(50),
  applicantCountry: z.string().trim().max(4).default(""),
  resumeText: z.string().trim().min(20).max(50000),
  salaryExpectation: z.string().trim().max(1000).default(""),
  noticePeriod: z.string().trim().max(1000).default(""),
  availability: z.string().trim().max(1000).default(""),
  skillsAssessment: z.string().trim().max(10000).default(""),
  roleExpectations: z.string().trim().max(10000).default(""),
  applicationSource: z.enum(candidateApplicationSources).default("Direct Application"),
  consent: z.boolean().optional().default(false),
});

export type CandidateStatusHistoryEntry = {
  historyId: string;
  applicationId: string;
  roleId: string;
  changedAt: string;
  previousStatus: string;
  newStatus: string;
  stage: ApplicantDecisionStage | "final";
  action: ApplicantHistoryAction;
  changedByName: string;
  changedByEmail: string;
  comments: string;
  rejectionReason: string;
  actionSource: string;
};

export type CreateInterviewSlotInput = {
  interviewType: "AI Voice Interview" | "Final Interview";
  roleId: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
};

export type BookingSlot = {
  slotId: string;
  interviewType: string;
  roleId: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  status?: string;
  applicationId?: string;
  calendarEventId?: string;
  calendarEventLink?: string;
  calendarEventStatus?: string;
  calendarEventError?: string;
  interviewerName?: string;
  interviewerEmail?: string;
  hodName?: string;
  hodEmail?: string;
};

export type BookingContext = {
  kind: BookingKind;
  applicationId: string;
  candidateName: string;
  email: string;
  selectedRole: string;
  roleId: string;
  bookingStatus: string;
  scheduledDate: string;
  scheduledTime: string;
  timezone: string;
  appliedAt: string;
  preferredMobile: string;
  /** Physical venue for a face-to-face (final) interview, when configured. */
  finalInterviewVenue?: string;
  currentSlot?: BookingSlot;
  slots: BookingSlot[];
};

const spreadsheetId = process.env.GOOGLE_CANDIDATE_SPREADSHEET_ID || process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = getGoogleServiceAccountPrivateKey();

if (!spreadsheetId || !serviceAccountEmail || !privateKey) throw new Error("Candidate spreadsheet access is not configured.");

const auth = new google.auth.JWT({ email: serviceAccountEmail, key: privateKey, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const sheets = google.sheets({ version: "v4", auth });

type Row = Record<string, string>;
type SheetData = { headers: string[]; rows: Row[]; rowNumbers: number[] };

function text(value: unknown) { return String(value ?? "").trim(); }
function normalize(value: unknown) { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
function field(row: Row, ...names: string[]) { for (const name of names) { const key = normalize(name); if (key in row) return row[key]; } return ""; }
function columnName(index: number) { let name = ""; let value = index + 1; while (value > 0) { const remainder = (value - 1) % 26; name = String.fromCharCode(65 + remainder) + name; value = Math.floor((value - 1) / 26); } return name; }
function hashToken(token: string) { return crypto.createHash("sha256").update(token).digest("hex"); }
function tokenFromBookingLink(link: string) {
  try {
    const path = new URL(link, "http://localhost").pathname.split("/").filter(Boolean);
    if (path.at(-2) !== "final" || !path.at(-1)) return "";
    return decodeURIComponent(path.at(-1) || "");
  } catch {
    return "";
  }
}

function finalBookingTokenExpiry(existing: string, configuredDays: number) {
  const existingTime = Date.parse(existing);
  if (Number.isFinite(existingTime) && existingTime > Date.now()) return existing;
  const expiryDays = Number.isFinite(configuredDays) ? Math.min(Math.max(configuredDays, 1), 30) : 7;
  return new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
}

function finalBookingInvitation(row: Row, baseUrl: string, expiryDays: number) {
  const existingStatus = field(row, "Final_Interview_Booking_Token_Status").toLowerCase();
  const mustIssueNewToken = ["used", "booked", "expired", "revoked"].includes(existingStatus);
  const existingLink = field(row, "Final_Interview_Booking_Link");
  const existingToken = mustIssueNewToken ? "" : field(row, "Final_Interview_Booking_Token") || tokenFromBookingLink(existingLink);
  const token = existingToken || crypto.randomBytes(32).toString("hex");

  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: finalBookingTokenExpiry(mustIssueNewToken ? "" : field(row, "Final_Interview_Booking_Token_Expires_At"), expiryDays),
    link: bookingLink(baseUrl, "final", token),
  };
}

function normalizeEmail(value: string) { return text(value).toLowerCase(); }
export function normalizePreferredMobile(value: string) {
  const normalized = text(value).replace(/[\s().-]+/g, "");
  if (/^00[1-9]\d{7,14}$/.test(normalized)) return `+${normalized.slice(2)}`;
  if (/^\d{8,15}$/.test(normalized)) return `+${normalized}`;
  return normalized;
}

// Applications are only supported for PH, SG, and MY. See CountryOptions.tsx.
function inferApplicantCountry(value: string) {
  const digits = text(value).replace(/\D/g, "").replace(/^00/, "");
  if (digits.startsWith("63")) return "PH";
  if (digits.startsWith("65")) return "SG";
  if (digits.startsWith("60")) return "MY";
  return "";
}

// Restricted to the three countries applications are supported for (see
// CountryOptions.tsx) rather than accepting any E.164 number — a candidate
// typing a +966 number by hand, bypassing the dropdown, was previously
// accepted by this generic check.
export function isPreferredMobileValid(value: string) {
  const normalized = normalizePreferredMobile(value);
  if (/^\+63\d{10}$/.test(normalized)) return true; // Philippines
  if (/^\+65\d{8}$/.test(normalized)) return true; // Singapore
  if (/^\+60\d{8,10}$/.test(normalized)) return true; // Malaysia
  return false;
}

// Sheets' USER_ENTERED write mode parses cell values the same way the UI
// would: a leading "+" reads as a numeric expression, so "+60127717025"
// silently loses its "+" and lands in the sheet as a plain number. Vapi/n8n
// then fails to dial an international-format number. Prefixing with "'"
// (the standard Sheets "force text" marker) keeps the "+" intact without
// switching the whole batch off USER_ENTERED, which other columns rely on
// for date/number parsing.
function asTextCell(value: string) { return value ? `'${value}` : value; }

async function readSheet(tab: string, endColumn: string, options: { fresh?: boolean } = {}): Promise<SheetData> {
  // Cached: reserveBooking() alone reads Interview_Slots and
  // High_Match_Profile up to three times per call (getBookingContext, its
  // own Promise.all, then updateCells locating column indices). A short
  // cache turns those into one real API read plus cache hits, instead of
  // burning three read-quota units for identical data.
  const fetchValues = async () => {
    // Use whole-column A1 notation. A range such as A1:X is rejected by the
    // Sheets API because the end row is omitted; this reader is used by the
    // maintenance poller as well as interactive booking paths.
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab.replace(/'/g, "''")}'!A:${endColumn}` });
    return response.data.values ?? [];
  };
  // The decision API and the detail page may run on different serverless
  // instances. Bypass the process-local cache for the status history so the
  // just-recorded action is visible immediately after navigation.
  const values = options.fresh
    ? await fetchValues()
    : await cachedSheetsRead(`${tab}:${endColumn}:${spreadsheetId}`, fetchValues);
  const headers = (values[0] ?? []).map(text);
  const rows: Row[] = [];
  const rowNumbers: number[] = [];
  values.slice(1).forEach((valuesRow, index) => {
    if (!valuesRow.some((value) => text(value))) return;
    rows.push(Object.fromEntries(headers.map((header, column) => [normalize(header), text(valuesRow[column])])));
    rowNumbers.push(index + 2);
  });
  return { headers, rows, rowNumbers };
}

async function appendRows(tab: string, values: string[][]) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tab.replace(/'/g, "''")}'!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
  invalidateSheetsCache(tab);
}

function findApplicant(data: SheetData, applicationId: string) {
  const wanted = decodeURIComponent(applicationId).trim().toLowerCase();
  const index = data.rows.findIndex((row) => field(row, "Application ID", "Application_ID").toLowerCase() === wanted);
  return index < 0 ? null : { row: data.rows[index], rowNumber: data.rowNumbers[index] };
}

function bookingKindValue(kind: BookingKind) { return kind === "voice" ? "AI Voice Interview" : "Final Interview"; }

function slotFrom(row: Row): BookingSlot {
  return {
    slotId: field(row, "Slot_ID", "Slot ID"),
    interviewType: field(row, "Interview_Type", "Interview Type"),
    roleId: field(row, "Role_ID", "Role ID"),
    // Legacy workbooks contain both locale-formatted dates and time cells
    // returned as full timestamps. Normalize at the boundary so a malformed
    // Sheets representation cannot reach the candidate booking page.
    date: normalizeDateOnly(field(row, "Date")),
    startTime: normalizeTimeOnly(field(row, "Start_Time", "Start Time")),
    endTime: normalizeTimeOnly(field(row, "End_Time", "End Time")),
    timezone: field(row, "Timezone", "Time Zone"),
    status: field(row, "Status"),
    applicationId: field(row, "Application_ID", "Application ID"),
    calendarEventId: field(row, "Google_Calendar_Event_ID"),
    calendarEventLink: field(row, "Google_Calendar_Event_Link"),
    calendarEventStatus: field(row, "Google_Calendar_Event_Status"),
    calendarEventError: field(row, "Google_Calendar_Event_Error"),
    interviewerName: field(row, "Interviewer_Name", "Interviewer Name"),
    interviewerEmail: field(row, "Interviewer_Email", "Interviewer Email"),
    hodName: field(row, "HOD_Name", "HOD Name"),
    hodEmail: field(row, "HOD_Email", "HOD Email"),
  };
}

function slotSort(left: BookingSlot, right: BookingSlot) { return `${left.date} ${left.startTime}`.localeCompare(`${right.date} ${right.startTime}`); }

function rowAsVoiceCapacitySlot(row: Row): BookingSlot {
  return {
    slotId: field(row, "Slot_ID", "Slot ID"),
    interviewType: field(row, "Interview_Type", "Interview Type"),
    roleId: field(row, "Role_ID", "Role ID"),
    date: normalizeDateOnly(field(row, "Date")),
    startTime: normalizeTimeOnly(field(row, "Start_Time", "Start Time")),
    endTime: normalizeTimeOnly(field(row, "End_Time", "End Time")),
    timezone: field(row, "Timezone", "Time Zone") || "Asia/Singapore",
    status: field(row, "Status"),
  };
}

function activeVoiceBookingCount(rows: Row[], slot: Pick<BookingSlot, "date" | "startTime" | "endTime" | "timezone">) {
  return countActiveVoiceInterviews(rows.map((row) => rowAsVoiceCapacitySlot(row)), slot);
}

function interviewSlotRowValues(headers: string[], slot: Pick<BookingSlot, "date" | "startTime" | "endTime" | "timezone" | "interviewType" | "roleId">, context: BookingContext, status: "Available" | "Booked", slotId: string, bookedAt = "") {
  return headers.map((header) => {
    const key = normalize(header);
    if (key === normalize("Slot_ID")) return slotId;
    if (key === normalize("Interview_Type")) return slot.interviewType;
    if (key === normalize("Role_ID")) return slot.roleId;
    if (key === normalize("Date")) return slot.date;
    if (key === normalize("Start_Time")) return slot.startTime;
    if (key === normalize("End_Time")) return slot.endTime;
    if (key === normalize("Timezone")) return slot.timezone || "Asia/Singapore";
    if (key === normalize("Status")) return status;
    if (key === normalize("Application_ID")) return status === "Booked" ? context.applicationId : "";
    if (key === normalize("Candidate_Name")) return status === "Booked" ? context.candidateName : "";
    if (key === normalize("Candidate_Email")) return status === "Booked" ? context.email : "";
    if (key === normalize("Booked_At")) return status === "Booked" ? bookedAt : "";
    if (key === normalize("Last_Updated")) return bookedAt;
    return "";
  });
}

export function buildCandidateApplicationPayload(input: {
  applicationId: string;
  roleId: string;
  jobTitle?: string;
  department?: string;
  evaluationFields?: { key: string; label: string; description: string }[];
  source: string;
  candidate: CandidateApplicationInput & { consent?: boolean };
  submittedAt: string;
}): CandidateApplicationWebhookPayload {
  const email = normalizeEmail(input.candidate.email);
  return {
    eventType: "candidate_application_submitted",
    applicationId: input.applicationId,
    roleId: input.roleId,
    Role_ID: input.roleId,
    jobTitle: text(input.jobTitle),
    department: text(input.department),
    evaluationFields: input.evaluationFields || [],
    candidate: {
      name: text(input.candidate.candidateName),
      email,
      phone: text(input.candidate.phone),
      preferredMobile: normalizePreferredMobile(input.candidate.preferredMobile),
      applicantCountry: text(input.candidate.applicantCountry) || inferApplicantCountry(input.candidate.preferredMobile),
      resumeText: text(input.candidate.resumeText),
      salaryExpectation: text(input.candidate.salaryExpectation),
      noticePeriod: text(input.candidate.noticePeriod),
      availability: text(input.candidate.availability),
      skillsAssessment: text(input.candidate.skillsAssessment),
      roleExpectations: text(input.candidate.roleExpectations),
      applicationSource: text(input.candidate.applicationSource),
      consent: input.candidate.consent,
    },
    submittedAt: input.submittedAt,
    source: input.source,
    applicationSource: text(input.candidate.applicationSource),
    ...(input.candidate.resumeFile ? {
      resumeFile: {
        fileId: input.candidate.resumeFile.fileId,
        fileName: input.candidate.resumeFile.fileName,
        mimeType: input.candidate.resumeFile.mimeType,
        size: input.candidate.resumeFile.size,
        sha256: input.candidate.resumeFile.sha256,
        uploadedAt: input.candidate.resumeFile.uploadedAt,
        expiresAt: input.candidate.resumeFile.expiresAt,
        kind: input.candidate.resumeFile.kind,
      },
    } : {}),
  };
}

export async function sendCandidateApplicationWebhook(webhookUrl: string, webhookSecret: string, payload: CandidateApplicationWebhookPayload) {
  // Demo mode accepts new applicants and lets n8n run screening. Candidate
  // contact workflows remain disabled separately, so this handoff does not
  // email, call, or book the applicant.
  //
  // n8n runs synchronous AI CV screening on this request, so it is the slowest
  // blocking call in the portal. Bound it so a stuck workflow surfaces as a
  // clear error instead of hanging until the serverless function is killed.
  const configured = Number(process.env.N8N_CANDIDATE_APPLICATION_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": webhookSecret,
        "X-Idempotency-Key": payload.applicationId,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    return { response, result: result as Record<string, unknown> };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`The screening workflow did not respond within ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function buildCandidateStatusHistoryEntry(input: {
  applicationId: string;
  roleId: string;
  changedAt: string;
  previousStatus: string;
  newStatus: string;
  stage: ApplicantDecisionStage | "final";
  action: ApplicantHistoryAction;
  changedByName: string;
  changedByEmail: string;
  comments: string;
  rejectionReason?: string;
  actionSource?: string;
}) {
  const historyId = `HIST-${crypto.randomUUID()}`;
  return {
    historyId,
    applicationId: input.applicationId,
    roleId: input.roleId,
    changedAt: input.changedAt,
    previousStatus: input.previousStatus,
    newStatus: input.newStatus,
    stage: input.stage,
    action: input.action,
    changedByName: input.changedByName,
    changedByEmail: normalizeEmail(input.changedByEmail),
    comments: input.comments,
    rejectionReason: input.rejectionReason || "",
    actionSource: input.actionSource || "Applicant Review Portal",
  } satisfies CandidateStatusHistoryEntry;
}

function candidateHistoryValues(entry: CandidateStatusHistoryEntry): string[] {
  return [
    entry.historyId,
    entry.applicationId,
    entry.roleId,
    entry.changedAt,
    entry.previousStatus,
    entry.newStatus,
    entry.stage,
    entry.action,
    entry.changedByName,
    entry.changedByEmail,
    entry.comments,
    entry.rejectionReason,
    entry.actionSource,
  ];
}

export async function getCandidateStatusHistory(applicationId: string): Promise<CandidateStatusHistoryEntry[]> {
  if (isPostgresRecruitmentTarget()) {
    const rows = await listApplicationHistory(applicationId);
    return rows.map(({ history, externalId }) => ({
      historyId: history.id, applicationId: externalId, roleId: "", changedAt: text(history.changedAt), previousStatus: text(history.previousStage),
      newStatus: text(history.newStage), stage: (text(history.stage) || "resume") as CandidateStatusHistoryEntry["stage"], action: (text(history.decision) || "Completed") as ApplicantHistoryAction,
      changedByName: text(history.actorName), changedByEmail: text(history.actorEmail), comments: text(history.comments), rejectionReason: "", actionSource: text(history.source),
    }));
  }
  try {
    const { rows } = await readSheet("Candidate_Status_History", "M", { fresh: true });
    const normalizedApplicationId = text(applicationId).toLowerCase();
    return rows
      .filter((row) => field(row, "Application_ID", "Application ID").toLowerCase() === normalizedApplicationId)
      .map((row): CandidateStatusHistoryEntry => ({
        historyId: field(row, "History_ID", "History ID"),
        applicationId: field(row, "Application_ID", "Application ID"),
        roleId: field(row, "Role_ID", "Role ID"),
        changedAt: field(row, "Changed_At", "Changed At"),
        previousStatus: field(row, "Previous_Status", "Previous Status"),
        newStatus: field(row, "New_Status", "New Status"),
        stage: field(row, "Stage") as CandidateStatusHistoryEntry["stage"],
        action: field(row, "Action") as ApplicantHistoryAction,
        changedByName: field(row, "Changed_By_Name", "Changed By Name"),
        changedByEmail: field(row, "Changed_By_Email", "Changed By Email"),
        comments: field(row, "Comments"),
        rejectionReason: field(row, "Rejection_Reason", "Rejection Reason"),
        actionSource: field(row, "Action_Source", "Action Source"),
      }))
      .sort((left, right) => Date.parse(right.changedAt) - Date.parse(left.changedAt));
  } catch (error) {
    console.warn("[Candidate Status History] Unable to read history:", error);
    return [];
  }
}

export async function getBookingContext(kind: BookingKind, token: string): Promise<BookingContext | null> {
  if (isPostgresRecruitmentTarget()) return targetBookingContext(kind, hashToken(token)) as Promise<BookingContext | null>;
  await syncPastBookedInterviewsNoShow();
  await syncPastAvailableInterviewSlots();
  const [applicantData, slotsData] = await Promise.all([readSheet("High_Match_Profile", "CZ"), readSheet("Interview_Slots", "X")]);
  const cleanToken = text(token);
  const tokenHash = hashToken(cleanToken);
  const applicantIndex = applicantData.rows.findIndex((row) => kind === "voice"
    ? field(row, "Booking_Token") === cleanToken || field(row, "Booking_Token_Hash") === tokenHash
    : field(row, "Final_Interview_Booking_Token") === cleanToken || field(row, "Final_Interview_Booking_Token_Hash") === tokenHash);
  if (applicantIndex < 0) return null;

  const row = applicantData.rows[applicantIndex];
  const expiry = kind === "voice" ? field(row, "Booking_Token_Expires_At") : field(row, "Final_Interview_Booking_Token_Expires_At");
  if (expiry && Date.parse(expiry) < Date.now()) return null;
  const roleId = field(row, "Role_ID", "Role ID");
  const role = await getRoleRequestById(roleId);
  const normalizedSlots = slotsData.rows.map((raw, index) => ({ raw, slot: slotFrom(raw), index }));
  const currentSlot = normalizedSlots
    .find(({ slot }) => slot.applicationId === field(row, "Application ID", "Application_ID")
      && slot.interviewType === bookingKindValue(kind)
      && ["booked", "completed", "no show"].includes((slot.status || "").toLowerCase()));
  const tokenStatus = kind === "voice" ? field(row, "Booking_Token_Status") : field(row, "Final_Interview_Booking_Token_Status");
  // A completed booking token is normally single-use. A No Show is the one
  // exception: the candidate may use the original link to choose a
  // replacement slot, after which the token becomes used again.
  const canRescheduleNoShow = currentSlot?.slot.status?.toLowerCase() === "no show";
  // A used token can still display the confirmation for the candidate who
  // successfully booked it. It remains non-bookable because `slots` will be
  // ignored by the read-only confirmation state in the public UI. A used
  // token without its own booked slot is still invalid for late contenders.
  if (["used", "booked", "expired", "revoked"].includes(tokenStatus.toLowerCase()) && !currentSlot && !canRescheduleNoShow) return null;
  const status = tokenStatus || (kind === "voice" ? field(row, "Booking_Token_Status") : field(row, "Status 3 (Final Interview)"));
  const legacySlots = normalizedSlots
    .map(({ slot }) => slot)
    .filter((slot) => slot.roleId.toLowerCase() === roleId.toLowerCase())
    .filter((slot) => slot.interviewType === bookingKindValue(kind))
    .filter((slot) => (slot.status || "").toLowerCase() === "available")
    .filter((slot) => isBeforeTargetHiringDate(slot.date, role?.targetHiringDate))
    .filter((slot) => kind !== "voice" || isStandardVoiceInterviewSlot(slot))
    .filter((slot) => kind !== "final" || isStandardFinalInterviewSlot(slot))
    .filter((slot) => isCurrentCalendarMonth(slot.date, slot.timezone || role?.voiceInterviewTimezone || "Asia/Singapore"))
    .filter((slot) => {
      try {
        return scheduledInstant(slot.date, slot.startTime, slot.timezone || "Asia/Singapore").getTime() > Date.now();
      } catch {
        return false;
      }
    })
    .filter((slot) => slot.slotId)
    .sort(slotSort);
  const legacyAll = normalizedSlots
    .map(({ slot }) => slot)
    .filter((slot) => slot.roleId.toLowerCase() === roleId.toLowerCase())
    .filter((slot) => slot.interviewType === bookingKindValue(kind));
  const existingKeys = new Set(legacyAll.map((slot) => slotKey(slot)));
  const virtual = role
    ? virtualSlotsForRole(role, bookingKindValue(kind) as "AI Voice Interview" | "Final Interview")
      // Voice slots remain candidate-visible while their shared Vapi capacity
      // is below ten. The booked rows are counted below, so do not discard a
      // generated time merely because an earlier applicant used its first row.
      .filter((slot) => {
        if (kind !== "voice") return !existingKeys.has(slotKey(slot));
        const matchingRows = slotsData.rows.filter((row) => {
          const candidate = rowAsVoiceCapacitySlot(row);
          return candidate.roleId.toLowerCase() === roleId.toLowerCase()
            && candidate.interviewType.toLowerCase().includes("voice")
            && voiceInterviewConcurrencyKey(candidate) === voiceInterviewConcurrencyKey(slot);
        });
        return !matchingRows.some((row) => ["blocked", "expired"].includes(field(row, "Status").toLowerCase()));
      })
      .map((slot) => ({ ...slot }))
    : [];
  const candidateSlots = [...legacySlots, ...virtual]
    .filter((slot) => hasValidFutureTime(slot))
    .filter((slot) => slot.slotId)
    .sort(slotSort);
  const voiceCandidateSlots = kind === "voice"
    ? [...new Map(candidateSlots.map((slot) => [voiceInterviewConcurrencyKey(slot), slot])).values()]
      .map((slot) => {
        const activeCount = activeVoiceBookingCount(slotsData.rows, slot);
        if (activeCount >= MAX_CONCURRENT_VOICE_INTERVIEWS) return null;
        const availableRow = slotsData.rows.find((row) => {
          const candidate = rowAsVoiceCapacitySlot(row);
          return candidate.roleId.toLowerCase() === roleId.toLowerCase()
            && candidate.interviewType.toLowerCase().includes("voice")
            && candidate.status?.toLowerCase() === "available"
            && voiceInterviewConcurrencyKey(candidate) === voiceInterviewConcurrencyKey(slot);
        });
        return availableRow
          ? slotFrom(availableRow)
          : { ...slot, slotId: voiceCapacitySlotId(slot), status: "Available", applicationId: "" };
      })
      .filter((slot): slot is BookingSlot => Boolean(slot))
    : candidateSlots;
  const finalCalendarEmail = kind === "final" ? (await getFinalInterviewCalendarConfig()).email : "";
  let slots = kind === "final" ? [] : voiceCandidateSlots;
  if (kind === "final") {
    // Check every candidate-visible Final Interview slot against HR's
    // calendar, not just generated ("virtual") ones. A handful of real,
    // pre-existing Interview_Slots rows with Status=Available used to skip
    // this check entirely (isVirtualSlotId(slot.slotId) short-circuited to
    // true for them), so a slot that later became calendar-busy could still
    // show as bookable if it happened to already exist as a sheet row.
    if (finalCalendarEmail) {
      const instants = candidateSlots.flatMap((slot) => {
        try { return [scheduledInstant(slot.date, slot.startTime, slot.timezone || "Asia/Singapore"), scheduledInstant(slot.date, slot.endTime, slot.timezone || "Asia/Singapore")]; } catch { return []; }
      });
      if (instants.length > 0) {
        const busyResult = await getCalendarBusyWindows({ hodEmail: finalCalendarEmail, start: new Date(Math.min(...instants.map((value) => value.getTime()))), end: new Date(Math.max(...instants.map((value) => value.getTime()))) });
        slots = busyResult.checked
          ? candidateSlots.filter((slot) => {
            try {
              const start = scheduledInstant(slot.date, slot.startTime, slot.timezone || "Asia/Singapore").getTime();
              const end = scheduledInstant(slot.date, slot.endTime, slot.timezone || "Asia/Singapore").getTime();
              return !busyResult.busy.some((window) => Date.parse(window.start) < end && Date.parse(window.end) > start);
            } catch { return false; }
          })
          : [];
      }
    }
  }
  const scheduledDate = currentSlot?.slot.date || (kind === "voice"
    ? normalizeDateOnly(field(row, "Voice_Interview_Scheduled_Date"))
    : normalizeDateOnly(field(row, "Final_Interview_Scheduled_Date")));
  const scheduledTime = currentSlot?.slot.startTime || (kind === "voice"
    ? normalizeTimeOnly(field(row, "Voice_Interview_Scheduled_Time"))
    : normalizeTimeOnly(field(row, "Final_Interview_Scheduled_Time")));
  const timezone = currentSlot?.slot.timezone || (kind === "voice"
    ? field(row, "Voice_Interview_Timezone")
    : field(row, "Final_Interview_Timezone"));

  return {
    kind,
    applicationId: field(row, "Application ID", "Application_ID"),
    candidateName: field(row, "Candidate Name", "Candidate_Name"),
    email: field(row, "Email"),
    selectedRole: field(row, "Selected Role", "Selected_Role"),
    roleId,
    bookingStatus: status,
    preferredMobile: field(row, "Preferred_Mobile", "Preferred Mobile", "Contact_Number", "Contact Number", "Phone"),
    scheduledDate,
    scheduledTime,
    timezone,
    appliedAt: field(
      row,
      "Date of Application",
      "Date_of_Application",
      "Applied_At",
      "Applied At",
      "Created_At",
      "Created At",
      "Submitted_At",
      "Submitted At",
    ),
    finalInterviewVenue: kind === "final"
      ? (field(row, "Final_Interview_Venue") || role?.finalInterviewVenue || "")
      : "",
    currentSlot: currentSlot?.slot,
    slots,
  };
}

type CellUpdate = { tab: string; row: number; header: string; value: string };

async function ensureSheetColumnCapacity(tab: string, requiredColumnCount: number) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title,gridProperties(columnCount)))",
  });
  const properties = metadata.data.sheets
    ?.map((sheet) => sheet.properties)
    .find((sheet) => sheet?.title === tab);
  const currentColumnCount = properties?.gridProperties?.columnCount ?? 0;
  if (properties?.sheetId === undefined || currentColumnCount >= requiredColumnCount) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        appendDimension: {
          sheetId: properties.sheetId,
          dimension: "COLUMNS",
          length: requiredColumnCount - currentColumnCount,
        },
      }],
    },
  });
}

async function updateCells(updates: CellUpdate[]) {
  const grouped = new Map<string, CellUpdate[]>();
  updates.forEach((update) => grouped.set(update.tab, [...(grouped.get(update.tab) ?? []), update]));
  for (const [tab, tabUpdates] of grouped) {
    const data = await readSheet(tab,
      tab === "High_Match_Profile" ? "CZ" :
        tab === "Interview_Slots" ? "X" :
          tab === "Voice_Call_Queue" ? "X" : "AE");
    const requests: { range: string; values: string[][] }[] = [];
    const headers = [...data.headers];
    tabUpdates.forEach((update) => {
      let index = headers.findIndex((header) => normalize(header) === normalize(update.header));
      if (index < 0) {
        index = headers.length;
        headers.push(update.header);
        requests.push({ range: `'${tab}'!${columnName(index)}1`, values: [[update.header]] });
      }
      requests.push({ range: `'${tab}'!${columnName(index)}${update.row}`, values: [[update.value]] });
    });
    if (headers.length > data.headers.length) await ensureSheetColumnCapacity(tab, headers.length);
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "USER_ENTERED", data: requests } });
    invalidateSheetsCache(tab);
  }
}

export type ApplicantProfileUpdate = {
  candidateName: string;
  email: string;
  preferredMobile: string;
  applicantCountry: string;
};

export async function updateApplicantProfile(applicationId: string, input: ApplicantProfileUpdate) {
  if (isPostgresRecruitmentTarget()) {
    const result = await targetUpdateApplicantProfile({ applicationId, ...input });
    if (!result.application) throw new Error(result.error || "Applicant not found.");
    return { applicationId, candidateName: input.candidateName.trim(), email: input.email.trim().toLowerCase(), preferredMobile: normalizePreferredMobile(input.preferredMobile) };
  }
  const applicantData = await readSheet("High_Match_Profile", "CZ");
  const found = findApplicant(applicantData, applicationId);
  if (!found) throw new Error("Applicant not found.");

  const preferredMobile = normalizePreferredMobile(input.preferredMobile);
  if (!isPreferredMobileValid(preferredMobile)) throw new Error("Enter a valid international mobile number.");
  const now = new Date().toISOString();
  await updateCells([
    { tab: "High_Match_Profile", row: found.rowNumber, header: "Candidate_Name", value: input.candidateName.trim() },
    { tab: "High_Match_Profile", row: found.rowNumber, header: "Email", value: input.email.trim().toLowerCase() },
    { tab: "High_Match_Profile", row: found.rowNumber, header: "Preferred_Mobile", value: asTextCell(preferredMobile) },
    { tab: "High_Match_Profile", row: found.rowNumber, header: "Contact_Number", value: asTextCell(preferredMobile) },
    { tab: "High_Match_Profile", row: found.rowNumber, header: "Contact Number", value: asTextCell(preferredMobile) },
    { tab: "High_Match_Profile", row: found.rowNumber, header: "Applicant_Country", value: input.applicantCountry.trim().toUpperCase() },
    { tab: "High_Match_Profile", row: found.rowNumber, header: "Last_Updated", value: now },
  ]);

  const slots = await readSheet("Interview_Slots", "X");
  const slotUpdates = slots.rows.flatMap((row, index) => {
    if (field(row, "Application_ID", "Application ID").toLowerCase() !== applicationId.trim().toLowerCase()) return [];
    return [
      { tab: "Interview_Slots", row: slots.rowNumbers[index], header: "Candidate_Name", value: input.candidateName.trim() },
      { tab: "Interview_Slots", row: slots.rowNumbers[index], header: "Candidate_Email", value: input.email.trim().toLowerCase() },
    ];
  });
  if (slotUpdates.length > 0) await updateCells(slotUpdates);
  const callQueue = await readOptionalSheet("Voice_Call_Queue", "X");
  const queueUpdates = callQueue?.rows.flatMap((row, index) => {
    if (field(row, "Application_ID", "Application ID").toLowerCase() !== applicationId.trim().toLowerCase()) return [];
    return [
      { tab: "Voice_Call_Queue", row: callQueue.rowNumbers[index], header: "Candidate_Name", value: input.candidateName.trim() },
      { tab: "Voice_Call_Queue", row: callQueue.rowNumbers[index], header: "Candidate_Email", value: input.email.trim().toLowerCase() },
      { tab: "Voice_Call_Queue", row: callQueue.rowNumbers[index], header: "Preferred_Mobile", value: asTextCell(preferredMobile) },
      { tab: "Voice_Call_Queue", row: callQueue.rowNumbers[index], header: "Applicant_Country", value: input.applicantCountry.trim().toUpperCase() },
    ];
  }) || [];
  if (queueUpdates.length > 0) await updateCells(queueUpdates);
  return { applicationId, candidateName: input.candidateName.trim(), email: input.email.trim().toLowerCase(), preferredMobile };
}

async function readOptionalSheet(tab: string, endColumn: string): Promise<SheetData | null> {
  try {
    return await readSheet(tab, endColumn);
  } catch (error) {
    console.warn(`[Applicant Delete] Optional sheet ${tab} could not be read:`, error);
    return null;
  }
}

export async function deleteApplicant(applicationId: string) {
  const normalizedApplicationId = applicationId.trim().toLowerCase();
  if (!normalizedApplicationId) throw new Error("Applicant ID is required.");
  const [applicantData, slots, history, voiceResults, callLogs, finalTracking, callQueue] = await Promise.all([
    readSheet("High_Match_Profile", "CZ"),
    readOptionalSheet("Interview_Slots", "X"),
    readOptionalSheet("Candidate_Status_History", "M"),
    readOptionalSheet("Voice_Interview_Results", "AF"),
    readOptionalSheet("Voice_Call_Logs", "AD"),
    readOptionalSheet("Final_Interview_Tracking", "AE"),
    readOptionalSheet("Voice_Call_Queue", "X"),
  ]);
  const found = findApplicant(applicantData, normalizedApplicationId);
  if (!found) throw new Error("Applicant not found.");

  const activeVoiceStatus = field(found.row, "Status 2 (Voice Interview)").toLowerCase();
  const activeQueue = callQueue?.rows.some((row) =>
    field(row, "Application_ID", "Application ID").toLowerCase() === normalizedApplicationId &&
    ["calling", "initiated", "in progress"].includes(field(row, "Status").toLowerCase()),
  );
  if (["calling", "initiated", "in progress"].includes(activeVoiceStatus) || activeQueue) {
    throw new Error("This applicant cannot be deleted while the voice interview is in progress.");
  }

  const applicantSlots = slots?.rows
    .map((row, index) => ({ row, rowNumber: slots.rowNumbers[index] }))
    .filter(({ row }) => field(row, "Application_ID", "Application ID").toLowerCase() === normalizedApplicationId) || [];
  const finalBookedSlots = applicantSlots.filter(({ row }) =>
    field(row, "Interview_Type", "Interview Type").toLowerCase() === "final interview" &&
    field(row, "Status").toLowerCase() === "booked" &&
    field(row, "Google_Calendar_Event_ID"),
  );
  if (finalBookedSlots.length > 0) {
    const hodEmail = (await getFinalInterviewCalendarConfig()).email;
    if (!hodEmail) throw new Error("The HR interviewer email is not configured, so the linked calendar event cannot be removed.");
    for (const { row } of finalBookedSlots) {
      const result = await deleteFinalInterviewEvent(hodEmail, field(row, "Google_Calendar_Event_ID"), {
        allowDemoSideEffect: isDemoSideEffectAllowed(field(
          found.row,
          "Date of Application",
          "Date_of_Application",
          "Applied_At",
          "Applied At",
          "Created_At",
          "Created At",
          "Submitted_At",
          "Submitted At",
        )),
      });
      if (!result.deleted) throw new Error(result.error || "Unable to remove the linked HR-interview calendar event.");
    }
  }

  const relatedSheets: Array<[string, SheetData | null]> = [
    ["High_Match_Profile", applicantData],
    ["Interview_Slots", slots],
    ["Candidate_Status_History", history],
    ["Voice_Interview_Results", voiceResults],
    ["Voice_Call_Logs", callLogs],
    ["Final_Interview_Tracking", finalTracking],
    ["Voice_Call_Queue", callQueue],
  ];
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title))" });
  const sheetIds = new Map((metadata.data.sheets || []).map((sheet) => [sheet.properties?.title || "", sheet.properties?.sheetId]));
  const requests: { deleteDimension: { range: { sheetId: number; dimension: "ROWS"; startIndex: number; endIndex: number } } }[] = [];
  for (const [tab, data] of relatedSheets) {
    const sheetId = sheetIds.get(tab);
    if (typeof sheetId !== "number" || !data) continue;
    data.rows.forEach((row, index) => {
      if (field(row, "Application_ID", "Application ID").toLowerCase() !== normalizedApplicationId) return;
      const rowNumber = data.rowNumbers[index];
      requests.push({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber } } });
    });
  }
  if (requests.length === 0) throw new Error("No applicant records were found to delete.");
  requests.sort((left, right) => {
    const leftRange = left.deleteDimension.range;
    const rightRange = right.deleteDimension.range;
    return rightRange.sheetId - leftRange.sheetId || rightRange.startIndex - leftRange.startIndex;
  });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  relatedSheets.forEach(([tab]) => invalidateSheetsCache(tab));
  return { applicationId };
}

const reservationLocks = new Map<string, Promise<void>>();

async function withReservationLock<T>(key: string, operation: () => Promise<T>) {
  const previous = reservationLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  reservationLocks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (reservationLocks.get(key) === queued) reservationLocks.delete(key);
  }
}

// This serializes same-process contenders for one slot. Voice reservations use
// one shared lock because the ten-call limit is global across roles and time
// rows. Multi-instance deployments should move this reservation primitive to a
// shared database or distributed lock before running more than one app worker.
export async function reserveBooking(kind: BookingKind, token: string, slotId: string, preferredMobile: string) {
  const lockKey = kind === "voice" ? "voice-capacity" : `${kind}:${text(slotId)}`;
  if (isPostgresRecruitmentTarget()) return reserveTargetBooking(kind, token, slotId, preferredMobile);
  return withReservationLock(lockKey, () => reserveBookingInternal(kind, token, slotId, preferredMobile));
}

async function reserveTargetBooking(kind: BookingKind, token: string, slotId: string, preferredMobile: string) {
  const confirmedMobile = kind === "voice" ? normalizePreferredMobile(preferredMobile) : "";
  if (kind === "voice" && !isPreferredMobileValid(confirmedMobile)) throw new Error("Confirm a valid preferred mobile number in international format.");
  const context = await targetBookingContext(kind, hashToken(token));
  if (!context) throw new Error("This booking link is invalid or expired.");
  if (kind === "voice" && confirmedMobile) await targetUpdateApplicantProfile({ applicationId: context.applicationId, candidateName: context.candidateName, email: context.email, preferredMobile: confirmedMobile, applicantCountry: "" });
  const result = await targetReserveBooking(kind, hashToken(token), slotId, "public-booking");
  if (!result.booked) throw new Error(result.error || "The selected interview slot is no longer available.");
  return result;
}

async function reserveBookingInternal(kind: BookingKind, token: string, slotId: string, preferredMobile: string) {
  const cleanSlotId = text(slotId);
  if (!cleanSlotId) throw new Error("Choose an interview slot.");
  // A mobile number is only needed for the AI voice interview, which calls
  // the candidate. The HR interview is a calendar booking, not a phone call,
  // and the candidate's contact number is already on file from their
  // application, so re-collecting it here is unnecessary friction.
  const confirmedMobile = kind === "voice" ? normalizePreferredMobile(preferredMobile) : "";
  if (kind === "voice" && !isPreferredMobileValid(confirmedMobile)) throw new Error("Confirm a valid preferred mobile number in international format.");
  const [context, slotsData, applicantData] = await Promise.all([getBookingContext(kind, token), readSheet("Interview_Slots", "X", { fresh: true }), readSheet("High_Match_Profile", "CZ")]);
  if (!context) throw new Error("This booking link is invalid or expired.");
  if (!isDemoSideEffectAllowed(context.appliedAt)) {
    throw new Error("This demo booking link is protected because it belongs to historical data.");
  }
  // A new AI voice interview costs 10 Ella Credits. Rescheduling an existing
  // booking (context.currentSlot present) is not charged again.
  if (kind === "voice" && !context.currentSlot) {
    try {
      await assertCreditsAvailable(1, "phone_interview");
    } catch (creditError) {
      if (creditError instanceof EllaCreditsError) {
        throw new Error("AI voice interviews are temporarily unavailable. Please contact the recruiter.");
      }
      throw creditError;
    }
  }
  const role = await getRoleRequestById(context.roleId);
  const finalCalendarEmail = kind === "final" ? (await getFinalInterviewCalendarConfig()).email : "";
  let matchingSlotIndex = slotsData.rows.findIndex((row) => field(row, "Slot_ID", "Slot ID") === cleanSlotId);
  let matchingSlot = matchingSlotIndex >= 0 ? slotsData.rows[matchingSlotIndex] : undefined;
  let virtualReservation = false;
  if (matchingSlotIndex < 0) {
    const virtualSlot = context.slots.find((slot) => slot.slotId === cleanSlotId);
    const isCapacitySlot = kind === "voice" && cleanSlotId === voiceCapacitySlotId(virtualSlot || { date: "", startTime: "", endTime: "", timezone: "" });
    if (!virtualSlot || (!isVirtualSlotId(cleanSlotId) && !isCapacitySlot)) throw new Error("The selected interview slot is no longer available.");
    if (!hasValidFutureTime(virtualSlot)) throw new Error("This interview slot has already passed. Choose another time.");
    if (kind === "voice" && activeVoiceBookingCount(slotsData.rows, virtualSlot) >= MAX_CONCURRENT_VOICE_INTERVIEWS) {
      throw new Error("This AI Voice Interview time has reached the maximum of 10 concurrent calls. Choose another time.");
    }
    if (kind === "final") {
      const hodEmail = finalCalendarEmail;
      if (!hodEmail) throw new Error("No HR interviewer email is configured for this role.");
      const calendar = await checkCalendarAvailability({ hodEmail, date: virtualSlot.date, startTime: virtualSlot.startTime, endTime: virtualSlot.endTime, timezone: virtualSlot.timezone });
      if (!calendar.checked) throw new Error(calendar.reason === "not_connected" ? "Connect the HR Google Calendar before booking an HR interview." : "Unable to verify the HR Google Calendar. Please try again.");
      if (!calendar.available) throw new Error("This HR interview time is now blocked by the HR Google Calendar. Choose another time.");
    }
    const bookingAt = new Date().toISOString();
    const bookingSlotId = kind === "voice" ? `SLOT-${crypto.randomUUID().slice(0, 8).toUpperCase()}` : virtualSlot.slotId;
    const values = interviewSlotRowValues(slotsData.headers, virtualSlot, context, "Booked", bookingSlotId, bookingAt);
    await appendRows("Interview_Slots", [values]);
    invalidateSheetsCache("Interview_Slots");
    const refreshedSlots = await readSheet("Interview_Slots", "X", { fresh: true });
    matchingSlotIndex = refreshedSlots.rows.findIndex((row) => field(row, "Slot_ID", "Slot ID") === bookingSlotId);
    if (matchingSlotIndex < 0) throw new Error("The selected interview slot could not be reserved. Try again.");
    matchingSlot = refreshedSlots.rows[matchingSlotIndex];
    slotsData.rows = refreshedSlots.rows;
    slotsData.rowNumbers = refreshedSlots.rowNumbers;
    virtualReservation = true;
  }
  if (!matchingSlot) throw new Error("The selected interview slot is no longer available.");
  const normalizedMatchingSlot = slotFrom(matchingSlot);
  // Re-check at confirmation time so a page opened earlier cannot reserve a
  // slot that has since started or passed.
  if (!hasValidFutureTime(normalizedMatchingSlot)) throw new Error("This interview slot has already passed. Choose another time.");
  if (!isBeforeTargetHiringDate(normalizedMatchingSlot.date, role?.targetHiringDate)) throw new Error("This interview slot is outside the role's target hiring window. Choose another slot.");
  const matchingStatus = field(matchingSlot, "Status").toLowerCase();
  const matchingVoiceSlot = kind === "voice" && field(matchingSlot, "Interview_Type", "Interview Type").toLowerCase().includes("voice");
  const matchingVoiceBooking = matchingVoiceSlot && isActiveVoiceInterviewStatus(matchingStatus);
  if (((kind !== "voice" && !virtualReservation && matchingStatus !== "available")
    || (kind === "voice" && !virtualReservation && matchingStatus !== "available" && !matchingVoiceBooking))
    || field(matchingSlot, "Interview_Type", "Interview Type") !== bookingKindValue(kind)
    || field(matchingSlot, "Role_ID", "Role ID").toLowerCase() !== context.roleId.toLowerCase()) {
    throw new Error("The selected interview slot is no longer available.");
  }
  if (kind === "voice" && activeVoiceBookingCount(slotsData.rows, rowAsVoiceCapacitySlot(matchingSlot)) >= MAX_CONCURRENT_VOICE_INTERVIEWS) {
    throw new Error("This AI Voice Interview time has reached the maximum of 10 concurrent calls. Choose another time.");
  }
  // A booked row is an existing applicant's appointment, not a reusable
  // capacity ticket. Add a new row for the next applicant so no booking can
  // overwrite another candidate, while the shared time remains bookable up
  // to Vapi's ten-call limit.
  if (kind === "voice" && !virtualReservation && matchingStatus !== "available") {
    const bookingAt = new Date().toISOString();
    const bookingSlotId = `SLOT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await appendRows("Interview_Slots", [interviewSlotRowValues(slotsData.headers, rowAsVoiceCapacitySlot(matchingSlot), context, "Booked", bookingSlotId, bookingAt)]);
    const refreshedSlots = await readSheet("Interview_Slots", "X", { fresh: true });
    matchingSlotIndex = refreshedSlots.rows.findIndex((row) => field(row, "Slot_ID", "Slot ID") === bookingSlotId);
    if (matchingSlotIndex < 0) throw new Error("The selected interview slot could not be reserved. Try again.");
    matchingSlot = refreshedSlots.rows[matchingSlotIndex];
    slotsData.rows = refreshedSlots.rows;
    slotsData.rowNumbers = refreshedSlots.rowNumbers;
    virtualReservation = true;
  }

  const now = new Date().toISOString();
  const slotRow = slotsData.rowNumbers[matchingSlotIndex];
  const applicantIndex = applicantData.rows.findIndex((row) => field(row, "Application ID", "Application_ID") === context.applicationId);
  if (applicantIndex < 0) throw new Error("Applicant record not found.");
  const applicantRow = applicantData.rowNumbers[applicantIndex];
  const oldSlotIndex = context.currentSlot
    ? slotsData.rows.findIndex((row) => field(row, "Slot_ID", "Slot ID") === context.currentSlot?.slotId)
    : -1;
  if (oldSlotIndex === matchingSlotIndex) throw new Error("Choose a different interview slot to reschedule.");
  const calendarHodEmail = finalCalendarEmail;
  if (kind === "final") {
    if (!calendarHodEmail) throw new Error("No HR interviewer email is configured for this role.");
    const calendar = await checkCalendarAvailability({ hodEmail: calendarHodEmail, date: normalizedMatchingSlot.date, startTime: normalizedMatchingSlot.startTime, endTime: normalizedMatchingSlot.endTime, timezone: normalizedMatchingSlot.timezone || "Asia/Singapore" });
    if (!calendar.checked) throw new Error(calendar.reason === "not_connected" ? "Connect the HR Google Calendar before booking an HR interview." : "Unable to verify the HR Google Calendar. Please try again.");
    if (!calendar.available) throw new Error("This HR interview time is now blocked by the HR Google Calendar. Choose another time.");
  }
  let oldCalendarEventCleanup: { deleted: true } | { deleted: false; reason: "not_connected" | "error" | "demo_mode"; error?: string } | null = null;
  if (kind === "final" && oldSlotIndex >= 0 && calendarHodEmail) {
    const oldEventId = field(slotsData.rows[oldSlotIndex], "Google_Calendar_Event_ID");
    if (oldEventId) oldCalendarEventCleanup = await deleteFinalInterviewEvent(calendarHodEmail, oldEventId, {
      allowDemoSideEffect: isDemoSideEffectAllowed(context.appliedAt),
    });
  }
  const updates: CellUpdate[] = [
    { tab: "Interview_Slots", row: slotRow, header: "Status", value: "Booked" },
    { tab: "Interview_Slots", row: slotRow, header: "Application_ID", value: context.applicationId },
    { tab: "Interview_Slots", row: slotRow, header: "Candidate_Name", value: context.candidateName },
    { tab: "Interview_Slots", row: slotRow, header: "Candidate_Email", value: context.email },
    { tab: "Interview_Slots", row: slotRow, header: "Booked_At", value: now },
    { tab: "Interview_Slots", row: slotRow, header: "Last_Updated", value: now },
  ];
  if (oldSlotIndex >= 0) {
    const oldSlotRow = slotsData.rowNumbers[oldSlotIndex];
    updates.push(
      { tab: "Interview_Slots", row: oldSlotRow, header: "Status", value: "Available" },
      { tab: "Interview_Slots", row: oldSlotRow, header: "Application_ID", value: "" },
      { tab: "Interview_Slots", row: oldSlotRow, header: "Candidate_Name", value: "" },
      { tab: "Interview_Slots", row: oldSlotRow, header: "Candidate_Email", value: "" },
      { tab: "Interview_Slots", row: oldSlotRow, header: "Booked_At", value: "" },
      { tab: "Interview_Slots", row: oldSlotRow, header: "Last_Updated", value: now },
    );
    if (kind === "final") {
      updates.push(
        { tab: "Interview_Slots", row: oldSlotRow, header: "Google_Calendar_Event_Status", value: oldCalendarEventCleanup?.deleted ? "Cancelled" : oldCalendarEventCleanup ? "Cancellation Failed" : "Not Tracked" },
        { tab: "Interview_Slots", row: oldSlotRow, header: "Google_Calendar_Event_Error", value: oldCalendarEventCleanup && !oldCalendarEventCleanup.deleted ? (oldCalendarEventCleanup.error || oldCalendarEventCleanup.reason) : "" },
      );
    }
  }
  // Only the voice booking collects a mobile number - do not overwrite the
  // applicant's existing contact number with a blank value when booking the
  // HR (final) interview.
  if (kind === "voice") {
    updates.push(
      { tab: "High_Match_Profile", row: applicantRow, header: "Preferred_Mobile", value: asTextCell(confirmedMobile) },
      { tab: "High_Match_Profile", row: applicantRow, header: "Contact_Number", value: asTextCell(confirmedMobile) },
      { tab: "High_Match_Profile", row: applicantRow, header: "Contact Number", value: asTextCell(confirmedMobile) },
      { tab: "High_Match_Profile", row: applicantRow, header: "Applicant_Country", value: field(applicantData.rows[applicantIndex], "Applicant_Country") || inferApplicantCountry(confirmedMobile) },
    );
  }
  let queueValues: string[] | null = null;
  if (kind === "voice") {
    updates.push(
      { tab: "High_Match_Profile", row: applicantRow, header: "Status 2 (Voice Interview)", value: "Scheduled" },
      { tab: "High_Match_Profile", row: applicantRow, header: "Final_Status", value: "AI Voice Interview Scheduled" },
      { tab: "High_Match_Profile", row: applicantRow, header: "Voice_Interview_Booking_Status", value: "Booked" },
      { tab: "High_Match_Profile", row: applicantRow, header: "Booking_Token_Status", value: "Used" },
      { tab: "High_Match_Profile", row: applicantRow, header: "Voice_Interview_Scheduled_Date", value: normalizedMatchingSlot.date },
      { tab: "High_Match_Profile", row: applicantRow, header: "Voice_Interview_Scheduled_Time", value: normalizedMatchingSlot.startTime },
      { tab: "High_Match_Profile", row: applicantRow, header: "Voice_Interview_Timezone", value: normalizedMatchingSlot.timezone || "Asia/Singapore" },
      { tab: "High_Match_Profile", row: applicantRow, header: "Booking_Completed_At", value: now },
      { tab: "High_Match_Profile", row: applicantRow, header: "Last_Updated", value: now },
    );
    // The AI calling workflow (n8n "AI Voice Interview Scheduled Calling")
    // reads scheduled calls from Voice_Call_Queue, not from High_Match_Profile
    // directly. Only the legacy n8n-hosted booking API used to write this row;
    // the portal's own booking route must enqueue it too, or a booking made
    // here never results in an actual call.
    const applicantRecord = applicantData.rows[applicantIndex];
    const queueData = await readSheet("Voice_Call_Queue", "X");
    const voiceMaxAttempts = Math.max(1, Math.round(await getPortalConfigNumber("Voice_Call_Max_Attempts", 3)));
    const scheduledDate = normalizedMatchingSlot.date;
    const scheduledTime = normalizedMatchingSlot.startTime;
    const scheduledTimezone = normalizedMatchingSlot.timezone || "Asia/Singapore";
    let scheduledAt = "";
    try {
      scheduledAt = scheduledInstant(scheduledDate, scheduledTime, scheduledTimezone).toISOString();
    } catch {
      // The booking has already passed the slot validation above. Keep the
      // legacy date/time fields usable if a malformed timezone reaches here.
    }
    const newQueueValues = queueData.headers.map((header) => {
      const key = normalize(header);
      if (key === normalize("Application_ID")) return context.applicationId;
      if (key === normalize("Candidate_Name")) return context.candidateName;
      if (key === normalize("Candidate_Email")) return context.email;
      if (key === normalize("Voice_Interview_Scheduled_Date")) return scheduledDate;
      if (key === normalize("Voice_Interview_Scheduled_Time")) return scheduledTime;
      if (key === normalize("Voice_Interview_Timezone")) return scheduledTimezone;
      if (key === normalize("Applicant_Country")) return field(applicantRecord, "Applicant_Country") || inferApplicantCountry(confirmedMobile);
      if (key === normalize("Preferred_Mobile")) return asTextCell(confirmedMobile);
      if (key === normalize("Contact_Number") || key === normalize("Contact Number")) return asTextCell(confirmedMobile);
      if (key === normalize("Role_ID")) return context.roleId;
      if (key === normalize("Voice_Call_Status")) return "Scheduled";
      if (key === normalize("Voice_Call_Attempts")) return "0";
      if (key === normalize("Voice_Call_Max_Attempts")) return String(voiceMaxAttempts);
      if (key === normalize("Voice_Call_Scheduled_At")) return scheduledAt;
      if (key === normalize("Last_Updated")) return now;
      return "";
    });
    if (oldSlotIndex >= 0) {
      const oldQueueUpdates = queueData.rows
        .map((queueRow, index) => ({ queueRow, rowNumber: queueData.rowNumbers[index] }))
        .filter(({ queueRow }) => field(queueRow, "Application_ID", "Application ID") === context.applicationId
          && ["scheduled", "queued"].includes(field(queueRow, "Voice_Call_Status").toLowerCase()))
        .flatMap(({ rowNumber }) => [
          { tab: "Voice_Call_Queue", row: rowNumber, header: "Voice_Call_Status", value: "Cancelled" },
          { tab: "Voice_Call_Queue", row: rowNumber, header: "Last_Updated", value: now },
        ]);
      updates.push(...oldQueueUpdates);
    }
    queueValues = newQueueValues;
  } else {
    updates.push(
      { tab: "High_Match_Profile", row: applicantRow, header: "Status 3 (Final Interview)", value: "Interview Scheduled" },
      { tab: "High_Match_Profile", row: applicantRow, header: "Final_Status", value: "Final Interview Scheduled" },
      { tab: "High_Match_Profile", row: applicantRow, header: "Final_Interview_Booking_Token_Status", value: "Used" },
      { tab: "High_Match_Profile", row: applicantRow, header: "Final_Interview_Booking_Token_Used_At", value: now },
      { tab: "High_Match_Profile", row: applicantRow, header: "Final_Interview_Scheduled_Date", value: normalizedMatchingSlot.date },
      { tab: "High_Match_Profile", row: applicantRow, header: "Final_Interview_Scheduled_Time", value: normalizedMatchingSlot.startTime },
      { tab: "High_Match_Profile", row: applicantRow, header: "Final_Interview_Timezone", value: normalizedMatchingSlot.timezone || "Asia/Singapore" },
      { tab: "High_Match_Profile", row: applicantRow, header: "Last_Updated", value: now },
    );
    const interviewerName = finalCalendarEmail ? "HR" : "";
    const interviewerEmail = finalCalendarEmail;
    updates.push(
      { tab: "Interview_Slots", row: slotRow, header: "Interviewer_Name", value: interviewerName },
      { tab: "Interview_Slots", row: slotRow, header: "Interviewer_Email", value: interviewerEmail },
      { tab: "Interview_Slots", row: slotRow, header: "HOD_Name", value: interviewerName },
      { tab: "Interview_Slots", row: slotRow, header: "HOD_Email", value: interviewerEmail },
    );
  }
  await updateCells(updates);
  if (kind === "voice") {
    // Keep one reusable availability row while the time has capacity. The
    // booked row above belongs to this applicant; it must never be reused for
    // another applicant because doing so would overwrite the appointment.
    const projectedRows = slotsData.rows.map((row, index) => index === matchingSlotIndex ? { ...row, status: "Booked" } : row);
    const bookedVoiceSlot = rowAsVoiceCapacitySlot(matchingSlot);
    const activeCount = activeVoiceBookingCount(projectedRows, bookedVoiceSlot);
    const hasAvailableCapacityRow = projectedRows.some((row) =>
      field(row, "Interview_Type", "Interview Type").toLowerCase().includes("voice")
      && field(row, "Status").toLowerCase() === "available"
      && voiceInterviewConcurrencyKey(rowAsVoiceCapacitySlot(row)) === voiceInterviewConcurrencyKey(bookedVoiceSlot),
    );
    if (activeCount < MAX_CONCURRENT_VOICE_INTERVIEWS && !hasAvailableCapacityRow) {
      await appendRows("Interview_Slots", [interviewSlotRowValues(slotsData.headers, bookedVoiceSlot, context, "Available", `SLOT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, now)]);
    }
  }
  if (queueValues) await appendRows("Voice_Call_Queue", [queueValues]);

  if (kind === "final") {
    // Keep the tracking tab aligned with the booked slot. A final
    // recommendation is only valid after the final interview decision; a
    // stale "Passed" value must not make a newly booked interview look
    // completed.
    try {
      await syncFinalTrackingBooking({
        applicationId: context.applicationId,
        candidateName: context.candidateName,
        candidateEmail: context.email,
        roleId: context.roleId,
        selectedRole: context.selectedRole,
        slot: matchingSlot,
        interviewerName: finalCalendarEmail ? "HR" : "",
        interviewerEmail: finalCalendarEmail,
        updatedAt: now,
      });
    } catch (error) {
      // The booking has already been reserved in the primary tabs. Do not
      // turn a successful candidate booking into a false failure if this
      // optional tracking tab is unavailable.
      console.warn("[Final Interview Tracking] Unable to sync booking:", error);
    }

    // Best-effort: put the event on HR's connected Google Calendar.
    // The role's requester remains a compatibility fallback for older records.
    // An HR interviewer who hasn't connected their
    // calendar yet, or a transient Calendar API error, must never fail the
    // candidate's booking — this runs after updateCells and only logs.
    try {
      if (calendarHodEmail) {
        const finalVenue = context.finalInterviewVenue?.trim() || role?.finalInterviewVenue?.trim() || "";
        const result = await createFinalInterviewEvent({
          hodEmail: calendarHodEmail,
          summary: `HR Interview: ${context.candidateName} — ${context.selectedRole}`,
          description: `HR interview for ${context.candidateName} (${context.applicationId}) applying for ${context.selectedRole}.\n\nCandidate email: ${context.email}${finalVenue ? `\n\nVenue:\n${finalVenue}` : ""}`,
          location: finalVenue,
          date: normalizedMatchingSlot.date,
          startTime: normalizedMatchingSlot.startTime,
          endTime: normalizedMatchingSlot.endTime,
          timezone: normalizedMatchingSlot.timezone || "Asia/Singapore",
          // Booking is already protected by the fixed demo cutoff and
          // synthetic-record guard above. Invite the eligible applicant so
          // Google Calendar sends the actual interview invitation.
          attendeeEmails: [context.email],
        });
        const calendarUpdates: CellUpdate[] = result.created
          ? [
            { tab: "Interview_Slots", row: slotRow, header: "Google_Calendar_Event_ID", value: result.eventId },
            { tab: "Interview_Slots", row: slotRow, header: "Google_Calendar_Event_Link", value: result.htmlLink },
            { tab: "Interview_Slots", row: slotRow, header: "Google_Calendar_Event_Status", value: "Created" },
            { tab: "Interview_Slots", row: slotRow, header: "Google_Calendar_Event_Error", value: "" },
          ]
          : [
            { tab: "Interview_Slots", row: slotRow, header: "Google_Calendar_Event_Status", value: result.reason === "not_connected" ? "HR Calendar Not Connected" : "Creation Failed" },
            { tab: "Interview_Slots", row: slotRow, header: "Google_Calendar_Event_Error", value: result.error || result.reason },
          ];
        await updateCells(calendarUpdates);
        if (result.created) console.log("[Final Interview Calendar] Event created:", result.htmlLink);
        else console.log("[Final Interview Calendar] Not created:", result.reason, "error" in result ? result.error : "");
      } else {
        await updateCells([
          { tab: "Interview_Slots", row: slotRow, header: "Google_Calendar_Event_Status", value: "HR Email Not Configured" },
          { tab: "Interview_Slots", row: slotRow, header: "Google_Calendar_Event_Error", value: "No HR interviewer email is configured for this role." },
        ]);
        console.log("[Final Interview Calendar] No HR interviewer email found for role:", context.roleId);
      }
    } catch (error) {
      console.error("[Final Interview Calendar] Unexpected failure:", error);
    }
  }

  // `context` was read before this booking's writes landed, so its
  // preferredMobile still reflects whatever was stored beforehand (which may
  // predate the E.164 fix, or simply be stale). confirmedMobile is the value
  // actually validated and just persisted — echo that instead so the
  // response matches the sheet.
  const bookedSlot = {
    ...slotFrom(matchingSlot),
    status: "Booked",
    applicationId: context.applicationId,
  };
  return { ...context, preferredMobile: confirmedMobile, bookingStatus: kind === "voice" ? "Scheduled" : "Interview Scheduled", scheduledDate: normalizedMatchingSlot.date, scheduledTime: normalizedMatchingSlot.startTime, timezone: normalizedMatchingSlot.timezone, currentSlot: bookedSlot, slots: [] };
}

async function syncFinalTrackingBooking(input: {
  applicationId: string;
  candidateName: string;
  candidateEmail: string;
  roleId: string;
  selectedRole: string;
  slot: Row;
  interviewerName: string;
  interviewerEmail: string;
  updatedAt: string;
}) {
  const data = await readSheet("Final_Interview_Tracking", "AE");
  const existingIndex = data.rows.findIndex((row) => field(row, "Application_ID", "Application ID") === input.applicationId);
  const existing = existingIndex >= 0 ? data.rows[existingIndex] : {};
  const slotDate = field(input.slot, "Date");
  const slotTime = field(input.slot, "Start_Time", "Start Time");
  const values = data.headers.map((header) => {
    const key = normalize(header);
    if (key === normalize("Application_ID")) return input.applicationId;
    if (key === normalize("Candidate_Name")) return input.candidateName;
    if (key === normalize("Candidate_Email")) return input.candidateEmail;
    if (key === normalize("Role_ID")) return input.roleId;
    if (key === normalize("Selected_Role")) return input.selectedRole;
    if (key === normalize("Final_Interview_Date")) return `${slotDate} ${slotTime}`.trim();
    if (key === normalize("Final_Interview_Status")) return "Interview Scheduled";
    if (key === normalize("Final_Recommendation")) return "Awaiting interview decision";
    if (key === normalize("Interviewer_Name")) return input.interviewerName;
    if (key === normalize("Interviewer_Email")) return input.interviewerEmail;
    if (key === normalize("Last_Updated")) return input.updatedAt;
    return existing[normalize(header)] || "";
  });
  if (existingIndex >= 0) {
    const rowNumber = data.rowNumbers[existingIndex];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Final_Interview_Tracking'!A${rowNumber}:${columnName(data.headers.length - 1)}${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "'Final_Interview_Tracking'!A1",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [values] },
    });
  }
  invalidateSheetsCache("Final_Interview_Tracking");
}

export async function markInterviewNoShow(slotId: string) {
  const cleanSlotId = text(slotId);
  if (!cleanSlotId) throw new Error("Interview slot is required.");
  const [slotsData, applicantsData] = await Promise.all([readSheet("Interview_Slots", "X"), readSheet("High_Match_Profile", "CZ")]);
  const slotIndex = slotsData.rows.findIndex((row) => field(row, "Slot_ID", "Slot ID") === cleanSlotId);
  if (slotIndex < 0) throw new Error("Interview slot not found.");
  const slot = slotsData.rows[slotIndex];
  if (field(slot, "Status").toLowerCase() !== "booked") throw new Error("Only booked interviews can be marked as No Show.");
  const scheduledAt = scheduledInstant(field(slot, "Date"), field(slot, "Start_Time", "Start Time"), field(slot, "Timezone", "Time Zone") || "Asia/Singapore");
  if (scheduledAt.getTime() > Date.now()) throw new Error("No Show can only be recorded after the scheduled start time.");
  const applicationId = field(slot, "Application_ID", "Application ID");
  const applicantIndex = applicantsData.rows.findIndex((row) => field(row, "Application_ID", "Application ID") === applicationId);
  if (applicantIndex < 0) throw new Error("Applicant record not found.");
  const now = new Date().toISOString();
  const slotRow = slotsData.rowNumbers[slotIndex];
  const applicantRow = applicantsData.rowNumbers[applicantIndex];
  const isVoice = field(slot, "Interview_Type", "Interview Type") === "AI Voice Interview";
  const interviewStatus = field(applicantsData.rows[applicantIndex], isVoice ? "Status 2 (Voice Interview)" : "Status 3 (Final Interview)").toLowerCase();
  if (interviewStatus.includes("interviewed") || interviewStatus.includes("completed")) throw new Error("This interview already has a completed result and cannot be marked as No Show.");
  const roleId = field(applicantsData.rows[applicantIndex], "Role_ID", "Role ID");

  // Voice interviews get an attempt 1..N retry lifecycle: a missed call is only
  // a terminal No Show once every configured attempt is used up. Final (F2F)
  // interviews stay a single-shot No Show.
  const [maxAttempts, retryGapHours] = await Promise.all([
    getPortalConfigNumber("Voice_Call_Max_Attempts", 3),
    getPortalConfigNumber("Voice_Call_Retry_Gap_Hours", 24),
  ]);
  const queueData = isVoice ? await readSheet("Voice_Call_Queue", "X") : { rows: [] as Row[], rowNumbers: [] as number[] };
  const priorMisses = queueData.rows.filter((queueRow) =>
    field(queueRow, "Application_ID", "Application ID") === applicationId
    && VOICE_MISS_QUEUE_STATUSES.includes(field(queueRow, "Voice_Call_Status").toLowerCase()),
  ).length;
  const outcome = isVoice
    ? voiceNoShowOutcome(priorMisses, maxAttempts, retryGapHours)
    : { terminal: true, attemptsUsed: 1, maxAttempts: 1, nextAttemptAt: "", slotStatus: "No Show", status2: "No Show", bookingStatus: "No Show", queueStatus: "No Show", finalStatus: "Final Interview No Show", historyAction: "No Show" as const, historyComment: "Face-to-face interview marked No Show." };

  const updates: CellUpdate[] = [
    { tab: "Interview_Slots", row: slotRow, header: "Status", value: outcome.slotStatus },
    { tab: "Interview_Slots", row: slotRow, header: "Last_Updated", value: now },
    { tab: "High_Match_Profile", row: applicantRow, header: "Last_Updated", value: now },
    { tab: "High_Match_Profile", row: applicantRow, header: isVoice ? "Status 2 (Voice Interview)" : "Status 3 (Final Interview)", value: outcome.status2 },
    { tab: "High_Match_Profile", row: applicantRow, header: "Final_Status", value: outcome.finalStatus },
  ];
  if (isVoice) updates.push({ tab: "High_Match_Profile", row: applicantRow, header: "Voice_Interview_Booking_Status", value: outcome.bookingStatus });
  if (isVoice) {
    queueData.rows
      .map((queueRow, index) => ({ queueRow, rowNumber: queueData.rowNumbers[index] }))
      .filter(({ queueRow }) => field(queueRow, "Application_ID", "Application ID") === applicationId
        && ["scheduled", "queued", "retry scheduled"].includes(field(queueRow, "Voice_Call_Status").toLowerCase()))
      .forEach(({ rowNumber }) => {
        updates.push(
          { tab: "Voice_Call_Queue", row: rowNumber, header: "Voice_Call_Status", value: outcome.queueStatus },
          { tab: "Voice_Call_Queue", row: rowNumber, header: "Voice_Call_Attempts", value: String(outcome.attemptsUsed) },
          { tab: "Voice_Call_Queue", row: rowNumber, header: "Last_Updated", value: now },
        );
        if (!outcome.terminal && outcome.nextAttemptAt) {
          updates.push({ tab: "Voice_Call_Queue", row: rowNumber, header: "Voice_Call_Scheduled_At", value: outcome.nextAttemptAt });
        }
      });
  }
  await updateCells(updates);

  try {
    const historyData = await readOptionalSheet("Candidate_Status_History", "M");
    if (historyData) {
      await appendRows("Candidate_Status_History", [candidateHistoryValues(buildCandidateStatusHistoryEntry({
        applicationId,
        roleId,
        changedAt: now,
        previousStatus: field(applicantsData.rows[applicantIndex], "Final_Status") || interviewStatus,
        newStatus: outcome.finalStatus,
        stage: isVoice ? "voice" : "final",
        action: outcome.historyAction,
        changedByName: "Recruitment Portal",
        changedByEmail: "system@recruitment-portal.local",
        comments: outcome.historyComment,
        actionSource: "HR Interview Status Action",
      }))]);
    }
  } catch (error) {
    console.warn("[Interview No Show] Unable to append status history:", error);
  }

  return { slotId: cleanSlotId, applicationId, status: outcome.status2, terminal: outcome.terminal, attempt: outcome.attemptsUsed, maxAttempts: outcome.maxAttempts };
}

const VOICE_MISS_QUEUE_STATUSES = ["missed", "no show", "retry scheduled"];

/**
 * Decides what a missed AI voice call means given how many attempts the
 * candidate has already used. `priorMisses` = queue rows for this application
 * already in a missed/retry/no-show state. When attempts remain the call is
 * re-queued for n8n; once exhausted it is a terminal No Show.
 */
function voiceNoShowOutcome(priorMisses: number, maxAttempts: number, retryGapHours: number) {
  const attemptsUsed = Math.max(1, priorMisses + 1);
  const cappedMax = Math.max(1, Math.round(maxAttempts));
  const terminal = attemptsUsed >= cappedMax;
  const nextAttemptAt = new Date(Date.now() + Math.max(1, retryGapHours) * 3600_000).toISOString();
  return {
    terminal,
    attemptsUsed,
    maxAttempts: cappedMax,
    nextAttemptAt,
    slotStatus: terminal ? "No Show" : "Booked",
    status2: terminal ? "No Show" : "Retry Scheduled",
    bookingStatus: terminal ? "No Show" : "Retry Scheduled",
    queueStatus: terminal ? "No Show" : "Retry Scheduled",
    finalStatus: terminal
      ? "AI Voice Interview No Show"
      : `AI Voice Interview Retry Scheduled (Attempt ${attemptsUsed + 1} of ${cappedMax})`,
    historyAction: "No Show" as const,
    historyComment: terminal
      ? `Final AI voice interview no-show after ${cappedMax} attempt${cappedMax === 1 ? "" : "s"}.`
      : `AI voice interview attempt ${attemptsUsed} of ${cappedMax} missed. The call is re-queued for a further attempt.`,
  };
}

function calendarDateKey(value: string, timezone: string) {
  const trimmed = text(value);
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) return `${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(parsed));
}

function todayInTimezone(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

let pastBookedNoShowSync: Promise<number> | null = null;
let pastAvailableSlotSync: Promise<number> | null = null;

function substantiveVoiceAnswerCount(transcript: string) {
  const ignored = /^(yes|no|okay|ok|sure|thank you|thanks|bye|goodbye|hello|hi)[.!?]*$/i;
  return text(transcript)
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*user\s*:\s*(.+)$/i)?.[1]?.trim() || "")
    .filter((answer) => answer.length >= 12 && !ignored.test(answer)).length;
}

function hasCompletedInterviewResult(rows: Row[] | undefined, applicationId: string, kind: BookingKind) {
  if (!rows || !applicationId) return false;
  return rows
    .filter((row) => field(row, "Application_ID", "Application ID").toLowerCase() === applicationId.toLowerCase())
    .some((row) => {
      const outcome = [
        field(row, "Call_Status", "Call Status"),
        field(row, "Call_Final_Status", "Call Final Status"),
        field(row, "Interview_Status", "Interview Status"),
        field(row, "Final_Interview_Status", "Final Interview Status"),
        field(row, "Final_Recommendation", "Final Recommendation"),
      ].join(" ").toLowerCase();
      if (/(completed|interviewed|passed|rejected|hired)/i.test(outcome)) return true;
      if (kind !== "voice") return false;
      const completeness = field(row, "Answer_Completeness", "Answer Completeness");
      if (/(all|every) configured questions? (were )?answered|interview (was )?completed/i.test(completeness)) return true;
      // A provider can label a finished call Incomplete even when the transcript
      // contains the candidate's answers. Only treat transcript evidence as
      // attendance when it contains several substantive answer turns; a lone
      // greeting or a no-answer recording must remain eligible for No Show.
      return substantiveVoiceAnswerCount(field(row, "Transcript", "Voice Transcript", "Call Transcript")) >= 3;
    });
}

/**
 * Reconcile appointment outcomes for every role. A booked slot becomes
 * Completed as soon as the voice/final result or applicant stage confirms
 * attendance; only an untouched appointment from a past calendar day becomes
 * No Show. Applicant outcomes such as Passed remain separate from slot state.
 */
export async function syncPastBookedInterviewsNoShow() {
  if (pastBookedNoShowSync) return pastBookedNoShowSync;
  pastBookedNoShowSync = (async () => {
    const [slotsData, applicantsData] = await Promise.all([
      readSheet("Interview_Slots", "X"),
      readSheet("High_Match_Profile", "CZ"),
    ]);
    const [voiceResultsData, callLogsData, finalTrackingData, historyData] = await Promise.all([
      readOptionalSheet("Voice_Interview_Results", "AF"),
      readOptionalSheet("Voice_Call_Logs", "AD"),
      readOptionalSheet("Final_Interview_Tracking", "AE"),
      readOptionalSheet("Candidate_Status_History", "M"),
    ]);
    let queueData: { rows: Row[]; rowNumbers: number[] } = { rows: [], rowNumbers: [] };
    try { queueData = await readSheet("Voice_Call_Queue", "X"); } catch { /* Older workbooks may not have this tab. */ }
    const [voiceMaxAttempts, voiceRetryGapHours] = await Promise.all([
      getPortalConfigNumber("Voice_Call_Max_Attempts", 3),
      getPortalConfigNumber("Voice_Call_Retry_Gap_Hours", 24),
    ]);

    const updates: CellUpdate[] = [];
    const historyRows: string[][] = [];
    let changed = 0;
    slotsData.rows.forEach((slot, slotIndex) => {
      if (field(slot, "Status").toLowerCase() !== "booked") return;
      const timezone = field(slot, "Timezone", "Time Zone") || "Asia/Singapore";
      const date = calendarDateKey(field(slot, "Date"), timezone);
      if (!date || date >= todayInTimezone(timezone)) return;

      const applicationId = field(slot, "Application_ID", "Application ID");
      const applicantIndex = applicantsData.rows.findIndex((row) => field(row, "Application_ID", "Application ID").toLowerCase() === applicationId.toLowerCase());
      const isVoice = field(slot, "Interview_Type", "Interview Type").toLowerCase().includes("voice");
      const applicant = applicantIndex >= 0 ? applicantsData.rows[applicantIndex] : undefined;
      if (!isDemoSideEffectAllowed(field(
        applicant || {},
        "Date of Application",
        "Date_of_Application",
        "Applied_At",
        "Applied At",
        "Created_At",
        "Created At",
        "Submitted_At",
        "Submitted At",
      ))) return;
      const interviewStatus = field(applicant || {}, isVoice ? "Status 2 (Voice Interview)" : "Status 3 (Final Interview)").toLowerCase();
      const resultRows = isVoice
        ? [...(voiceResultsData?.rows ?? []), ...(callLogsData?.rows ?? [])]
        : finalTrackingData?.rows;
      const hasAttendanceResult = interviewStatus.includes("interviewed")
        || interviewStatus.includes("completed")
        || hasCompletedInterviewResult(resultRows, applicationId, isVoice ? "voice" : "final");

      // Result feeds can arrive before the scheduled day ends. Reconcile the
      // slot immediately so the calendar does not keep reporting it as booked
      // after the applicant has already attended.
      if (hasAttendanceResult) {
        const now = new Date().toISOString();
        const slotRow = slotsData.rowNumbers[slotIndex];
        updates.push(
          { tab: "Interview_Slots", row: slotRow, header: "Status", value: "Completed" },
          { tab: "Interview_Slots", row: slotRow, header: "Last_Updated", value: now },
        );
        if (applicant && applicantIndex >= 0) {
          const applicantRow = applicantsData.rowNumbers[applicantIndex];
          const decision = field(applicant, isVoice ? "Voice_HR_Decision" : "Final_Interview_Decision", "HR_Decision").toLowerCase();
          const currentFinalStatus = field(applicant, "Final_Status");
          const hasDecision = ["approve", "approved", "reject", "rejected"].includes(decision)
            || /(passed|rejected|hired|not selected)/i.test(`${currentFinalStatus} ${interviewStatus}`);
          const completedStatus = isVoice ? "Completed" : "Interview Completed";
          const nextFinalStatus = hasDecision
            ? currentFinalStatus
            : `${isVoice ? "AI Voice Interview" : "Final Interview"} Completed - Awaiting HR Review`;
          updates.push(
            { tab: "High_Match_Profile", row: applicantRow, header: "Last_Updated", value: now },
            { tab: "High_Match_Profile", row: applicantRow, header: isVoice ? "Status 2 (Voice Interview)" : "Status 3 (Final Interview)", value: completedStatus },
            { tab: "High_Match_Profile", row: applicantRow, header: "Final_Status", value: nextFinalStatus },
          );
          if (isVoice) updates.push({ tab: "High_Match_Profile", row: applicantRow, header: "Voice_Interview_Booking_Status", value: "Completed" });
          if (historyData && nextFinalStatus !== currentFinalStatus) {
            historyRows.push(candidateHistoryValues(buildCandidateStatusHistoryEntry({
              applicationId,
              roleId: field(applicant, "Role_ID", "Role ID"),
              changedAt: now,
              previousStatus: currentFinalStatus || interviewStatus,
              newStatus: nextFinalStatus,
              stage: isVoice ? "voice" : "final",
              action: "Completed",
              changedByName: "Recruitment Portal",
              changedByEmail: "system@recruitment-portal.local",
              comments: `Automatically marked the ${isVoice ? "AI voice" : "final"} interview Completed after an attendance result was received.`,
              actionSource: "Automatic Interview Status Monitor",
            })));
          }
        }
        if (isVoice) {
          queueData.rows
            .map((queueRow, queueIndex) => ({ queueRow, rowNumber: queueData.rowNumbers[queueIndex] }))
            .filter(({ queueRow }) => field(queueRow, "Application_ID", "Application ID").toLowerCase() === applicationId.toLowerCase()
              && ["scheduled", "queued", "calling", "initiated", "in progress"].includes(field(queueRow, "Voice_Call_Status").toLowerCase()))
            .forEach(({ rowNumber }) => updates.push(
              { tab: "Voice_Call_Queue", row: rowNumber, header: "Voice_Call_Status", value: "Completed" },
              { tab: "Voice_Call_Queue", row: rowNumber, header: "Last_Updated", value: now },
            ));
        }
        if (!isVoice && finalTrackingData) {
          finalTrackingData.rows
            .map((trackingRow, trackingIndex) => ({ trackingRow, rowNumber: finalTrackingData.rowNumbers[trackingIndex] }))
            .filter(({ trackingRow }) => field(trackingRow, "Application_ID", "Application ID").toLowerCase() === applicationId.toLowerCase())
            .forEach(({ rowNumber }) => updates.push(
              { tab: "Final_Interview_Tracking", row: rowNumber, header: "Final_Interview_Status", value: "Completed" },
              { tab: "Final_Interview_Tracking", row: rowNumber, header: "Last_Updated", value: now },
            ));
        }
        changed += 1;
        return;
      }

      // Only an appointment with no attendance/result after its day has
      // passed is a No Show. Future bookings stay Scheduled/Booked.
      if (!date || date >= todayInTimezone(timezone)) return;

      // A voice retry that n8n has already re-queued must not be counted as a
      // fresh miss until its next scheduled attempt time has also passed —
      // otherwise a burst of getBookingContext() calls would exhaust every
      // attempt in seconds.
      if (isVoice) {
        const retryPending = queueData.rows.some((queueRow) =>
          field(queueRow, "Application_ID", "Application ID").toLowerCase() === applicationId.toLowerCase()
          && field(queueRow, "Voice_Call_Status").toLowerCase() === "retry scheduled"
          && Date.parse(field(queueRow, "Voice_Call_Scheduled_At", "Voice Call Scheduled At")) > Date.now());
        if (retryPending) return;
      }

      const now = new Date().toISOString();
      const priorMisses = isVoice
        ? queueData.rows.filter((queueRow) => field(queueRow, "Application_ID", "Application ID").toLowerCase() === applicationId.toLowerCase()
            && VOICE_MISS_QUEUE_STATUSES.includes(field(queueRow, "Voice_Call_Status").toLowerCase())).length
        : 0;
      const outcome = isVoice
        ? voiceNoShowOutcome(priorMisses, voiceMaxAttempts, voiceRetryGapHours)
        : { terminal: true, attemptsUsed: 1, maxAttempts: 1, nextAttemptAt: "", slotStatus: "No Show", status2: "No Show", bookingStatus: "No Show", queueStatus: "No Show", finalStatus: "Final Interview No Show", historyAction: "No Show" as const, historyComment: "" };
      updates.push(
        { tab: "Interview_Slots", row: slotsData.rowNumbers[slotIndex], header: "Status", value: outcome.slotStatus },
        { tab: "Interview_Slots", row: slotsData.rowNumbers[slotIndex], header: "Last_Updated", value: now },
      );
      if (applicant && applicantIndex >= 0) {
        const applicantRow = applicantsData.rowNumbers[applicantIndex];
        updates.push(
          { tab: "High_Match_Profile", row: applicantRow, header: "Last_Updated", value: now },
          { tab: "High_Match_Profile", row: applicantRow, header: isVoice ? "Status 2 (Voice Interview)" : "Status 3 (Final Interview)", value: outcome.status2 },
          { tab: "High_Match_Profile", row: applicantRow, header: "Final_Status", value: outcome.finalStatus },
        );
        if (isVoice) updates.push({ tab: "High_Match_Profile", row: applicantRow, header: "Voice_Interview_Booking_Status", value: outcome.bookingStatus });
      }
      if (isVoice) {
        queueData.rows
          .map((queueRow, queueIndex) => ({ queueRow, rowNumber: queueData.rowNumbers[queueIndex] }))
          .filter(({ queueRow }) => field(queueRow, "Application_ID", "Application ID").toLowerCase() === applicationId.toLowerCase() && ["scheduled", "queued", "retry scheduled"].includes(field(queueRow, "Voice_Call_Status").toLowerCase()))
          .forEach(({ rowNumber }) => {
            updates.push(
              { tab: "Voice_Call_Queue", row: rowNumber, header: "Voice_Call_Status", value: outcome.queueStatus },
              { tab: "Voice_Call_Queue", row: rowNumber, header: "Voice_Call_Attempts", value: String(outcome.attemptsUsed) },
              { tab: "Voice_Call_Queue", row: rowNumber, header: "Last_Updated", value: now },
            );
            if (!outcome.terminal && outcome.nextAttemptAt) {
              updates.push({ tab: "Voice_Call_Queue", row: rowNumber, header: "Voice_Call_Scheduled_At", value: outcome.nextAttemptAt });
            }
          });
      }
      if (!isVoice && finalTrackingData) {
        finalTrackingData.rows
          .map((trackingRow, trackingIndex) => ({ trackingRow, rowNumber: finalTrackingData.rowNumbers[trackingIndex] }))
          .filter(({ trackingRow }) => field(trackingRow, "Application_ID", "Application ID").toLowerCase() === applicationId.toLowerCase())
          .forEach(({ rowNumber }) => updates.push(
            { tab: "Final_Interview_Tracking", row: rowNumber, header: "Final_Interview_Status", value: "No Show" },
            { tab: "Final_Interview_Tracking", row: rowNumber, header: "Final_Recommendation", value: "No Show - Reschedule Required" },
            { tab: "Final_Interview_Tracking", row: rowNumber, header: "Last_Updated", value: now },
          ));
      }
      if (applicant && historyData) {
        historyRows.push(candidateHistoryValues(buildCandidateStatusHistoryEntry({
          applicationId,
          roleId: field(applicant, "Role_ID", "Role ID"),
          changedAt: now,
          previousStatus: field(applicant, "Final_Status") || interviewStatus,
          newStatus: outcome.finalStatus,
          stage: isVoice ? "voice" : "final",
          action: "No Show",
          changedByName: "Recruitment Portal",
          changedByEmail: "system@recruitment-portal.local",
          comments: isVoice && !outcome.terminal
            ? `AI voice interview attempt ${outcome.attemptsUsed} of ${outcome.maxAttempts} missed on ${date}; the call is re-queued for a further attempt.`
            : `Automatically marked No Show because the scheduled ${isVoice ? "voice" : "final"} interview date (${date}) passed without a completed result${isVoice ? ` after ${outcome.maxAttempts} attempt${outcome.maxAttempts === 1 ? "" : "s"}` : ""}.`,
          actionSource: "Automatic Interview Status Monitor",
        })));
      }
      changed += 1;
    });

    if (updates.length > 0) await updateCells(updates);
    if (historyRows.length > 0 && historyData) {
      try { await appendRows("Candidate_Status_History", historyRows); } catch (error) { console.warn("[Interview No Show Sync] Unable to append status history:", error); }
    }
    return changed;
  })().finally(() => { pastBookedNoShowSync = null; });
  return pastBookedNoShowSync;
}

/** Persistently expire available interview slots whose start time has passed. */
export async function syncPastAvailableInterviewSlots() {
  if (pastAvailableSlotSync) return pastAvailableSlotSync;
  pastAvailableSlotSync = (async () => {
    const slotsData = await readSheet("Interview_Slots", "X");
    const updates: CellUpdate[] = [];
    const now = Date.now();
    slotsData.rows.forEach((slot, slotIndex) => {
      if (field(slot, "Status").toLowerCase() !== "available") return;
      const timezone = field(slot, "Timezone", "Time Zone") || "Asia/Singapore";
      try {
        const scheduledAt = scheduledInstant(field(slot, "Date"), field(slot, "Start_Time", "Start Time"), timezone);
        if (!isDemoSideEffectAllowed(scheduledAt.toISOString())) return;
        if (scheduledAt.getTime() > now) return;
      } catch {
        return;
      }
      updates.push(
        { tab: "Interview_Slots", row: slotsData.rowNumbers[slotIndex], header: "Status", value: "Expired" },
        { tab: "Interview_Slots", row: slotsData.rowNumbers[slotIndex], header: "Last_Updated", value: new Date().toISOString() },
      );
    });
    if (updates.length > 0) await updateCells(updates);
    return updates.length / 2;
  })().finally(() => { pastAvailableSlotSync = null; });
  return pastAvailableSlotSync;
}

export async function createInterviewSlot(input: CreateInterviewSlotInput) {
  const roleId = text(input.roleId);
  const date = text(input.date);
  const startTime = text(input.startTime);
  const endTime = text(input.endTime);
  const timezone = text(input.timezone) || "Asia/Singapore";
  if (!roleId || !date || !startTime || !endTime) throw new Error("Role, date, start time, and end time are required.");
  if (input.interviewType !== "AI Voice Interview" && input.interviewType !== "Final Interview") throw new Error("Choose a valid interview type.");
  if (Number.isNaN(Date.parse(`${date}T${startTime}:00`)) || Number.isNaN(Date.parse(`${date}T${endTime}:00`)) || startTime >= endTime) throw new Error("Choose a valid interview time range.");
  if (!isValidTimezone(timezone)) throw new Error("Choose a valid interview timezone.");
  if (isPostgresRecruitmentTarget()) {
    if (input.interviewType === "Final Interview") throw new Error("HR interview availability is managed automatically through the connected HR Google Calendar.");
    return targetCreateInterviewSlot({ ...input, roleId });
  }
  if (scheduledInstant(date, startTime, timezone).getTime() <= Date.now()) throw new Error("Interview slots must start in the future. Choose a later date or time.");
  const role = input.interviewType === "Final Interview" ? await getRoleRequestById(roleId) : null;
  if (input.interviewType === "Final Interview" && !role) throw new Error("Role request not found.");
  if (input.interviewType === "Final Interview" && role) {
    if (!isStandardFinalInterviewSlot({ interviewType: input.interviewType, startTime, endTime })) throw new Error("HR interview slots must be one hour between 10:00 and 16:00, excluding 12:00–13:00.");
    if (!isBeforeTargetHiringDate(date, role.targetHiringDate)) throw new Error("The HR interview date must be on or before the role's target hiring date.");
    const hodEmail = (await getFinalInterviewCalendarConfig()).email;
    if (!hodEmail) throw new Error("No HR interviewer email is configured for this role.");
    const calendar = await checkCalendarAvailability({ hodEmail, date, startTime, endTime, timezone });
    if (!calendar.checked) throw new Error(calendar.reason === "not_connected" ? "Connect the assigned HR Google Calendar before adding an HR interview slot." : "Unable to verify the HR Google Calendar for this HR interview slot.");
    if (!calendar.available) throw new Error("The HR Google Calendar is busy during this HR interview slot.");
  }
  const data = await readSheet("Interview_Slots", "X");
  const duplicate = data.rows.some((row) => field(row, "Interview_Type", "Interview Type") === input.interviewType && field(row, "Role_ID", "Role ID").toLowerCase() === roleId.toLowerCase() && field(row, "Date") === date && field(row, "Start_Time", "Start Time") === startTime);
  if (duplicate) throw new Error("This role already has the same interview slot.");
  const slotId = `SLOT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const values = data.headers.map((header) => {
    const key = normalize(header);
    if (key === normalize("Slot_ID")) return slotId;
    if (key === normalize("Interview_Type")) return input.interviewType;
    if (key === normalize("Role_ID")) return roleId;
    if (key === normalize("Date")) return date;
    if (key === normalize("Start_Time")) return startTime;
    if (key === normalize("End_Time")) return endTime;
    if (key === normalize("Timezone")) return timezone;
    if (key === normalize("Status")) return "Available";
    if (key === normalize("Last_Updated")) return new Date().toISOString();
    return "";
  });
  await sheets.spreadsheets.values.append({ spreadsheetId, range: "'Interview_Slots'!A1", valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: [values] } });
  invalidateSheetsCache("Interview_Slots");
  return { slotId, interviewType: input.interviewType, roleId, date, startTime, endTime, timezone, status: "Available", applicationId: "", candidateName: "", candidateEmail: "", bookedAt: "", lastUpdated: new Date().toISOString() };
}

export async function createConfiguredVoiceInterviewSlots({ roleId, mode, manualSlots, autoStartDate, autoEndDate, timezone, targetHiringDate }: { roleId: string; mode: "none" | "manual" | "automatic"; manualSlots: VoiceInterviewSlot[]; autoStartDate: string; autoEndDate: string; timezone: string; targetHiringDate?: string }): Promise<{ created: number; skipped: number; slots: VoiceInterviewSlot[] }> {
  if (mode === "none") return { created: 0, skipped: 0, slots: [] };
  const durationMinutes = 10;
  const configuredSlots = mode === "automatic"
    ? generateAutomaticVoiceInterviewSlots({ startDate: autoStartDate, endDate: autoEndDate, timezone, durationMinutes })
    : manualSlots;
  if (configuredSlots.length === 0) throw new Error("No AI Voice Interview slots were generated from the selected availability.");
  if (configuredSlots.some((slot) => !isValidTimezone(slot.timezone))) throw new Error("Choose a valid timezone for every AI Voice Interview slot.");
  // Keep automatic voice availability limited to the current calendar month;
  // this prevents setup actions from creating hidden future-month rows.
  const slots = configuredSlots
    .filter((slot) => isStandardVoiceInterviewSlot({ interviewType: "AI Voice Interview", date: slot.date, startTime: slot.startTime, endTime: slot.endTime }))
    .filter((slot) => isBeforeTargetHiringDate(slot.date, targetHiringDate))
    .filter((slot) => isCurrentCalendarMonth(slot.date, slot.timezone))
    .filter((slot) => scheduledInstant(slot.date, slot.startTime, slot.timezone).getTime() > Date.now());
  if (slots.length === 0) throw new Error("No AI Voice Interview slots match the current month, target hiring date, and future-time rules.");

  if (isPostgresRecruitmentTarget()) {
    const createdSlots: VoiceInterviewSlot[] = [];
    let skipped = 0;
    for (const slot of slots) {
      const result = await targetCreateInterviewSlot({ roleId, interviewType: "AI Voice Interview", ...slot });
      if (result.created) createdSlots.push(slot); else skipped += 1;
    }
    return { created: createdSlots.length, skipped: skipped + (configuredSlots.length - slots.length), slots: createdSlots };
  }

  const data = await readSheet("Interview_Slots", "X");
  const existing = new Set(data.rows.map((row) => `${field(row, "Interview_Type", "Interview Type").toLowerCase()}|${field(row, "Role_ID", "Role ID").toLowerCase()}|${field(row, "Date")}|${field(row, "Start_Time", "Start Time")}`));
  const uniqueSlots = slots.filter((slot, index) => {
    const key = `ai voice interview|${roleId.toLowerCase()}|${slot.date}|${slot.startTime}`;
    if (existing.has(key) || slots.findIndex((candidate) => candidate.date === slot.date && candidate.startTime === slot.startTime && candidate.endTime === slot.endTime && candidate.timezone === slot.timezone) !== index) return false;
    existing.add(key);
    return true;
  });
  if (uniqueSlots.length === 0) return { created: 0, skipped: slots.length, slots: [] };

  const rows = uniqueSlots.map((slot) => {
    const slotId = `SLOT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    return data.headers.map((header) => {
      const key = normalize(header);
      if (key === normalize("Slot_ID")) return slotId;
      if (key === normalize("Interview_Type")) return "AI Voice Interview";
      if (key === normalize("Role_ID")) return roleId;
      if (key === normalize("Date")) return slot.date;
      if (key === normalize("Start_Time")) return slot.startTime;
      if (key === normalize("End_Time")) return slot.endTime;
      if (key === normalize("Timezone")) return slot.timezone;
      if (key === normalize("Status")) return "Available";
      if (key === normalize("Last_Updated")) return new Date().toISOString();
      return "";
    });
  });
  await sheets.spreadsheets.values.append({ spreadsheetId, range: "'Interview_Slots'!A1", valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: rows } });
  invalidateSheetsCache("Interview_Slots");
  return { created: uniqueSlots.length, skipped: slots.length - uniqueSlots.length, slots: uniqueSlots };
}

export type FinalInterviewSlotSyncResult = {
  created: number;
  blocked: number;
  unblocked: number;
  skipped: number;
  warnings: string[];
};

type ConfiguredInterviewSlot = {
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
};

function configuredSlotKey(slot: ConfiguredInterviewSlot) {
  return `${slot.date}|${slot.startTime}|${slot.endTime}|${slot.timezone}`;
}

function calendarBlockReason(result: CalendarAvailabilityResult) {
  if (result.checked && !result.available) return "HR Google Calendar is busy during this interview window.";
  if ("reason" in result && result.reason === "not_connected") return "The HR Google Calendar is not connected.";
  return "error" in result ? result.error || "The HR Google Calendar could not be verified." : "The HR Google Calendar could not be verified.";
}

function configuredSlotRow(data: SheetData, slot: ConfiguredInterviewSlot, roleId: string, status: string) {
  const slotId = `SLOT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  return data.headers.map((header) => {
    const key = normalize(header);
    if (key === normalize("Slot_ID")) return slotId;
    if (key === normalize("Interview_Type")) return "Final Interview";
    if (key === normalize("Role_ID")) return roleId;
    if (key === normalize("Date")) return slot.date;
    if (key === normalize("Start_Time")) return slot.startTime;
    if (key === normalize("End_Time")) return slot.endTime;
    if (key === normalize("Timezone")) return slot.timezone;
    if (key === normalize("Status")) return status;
    if (key === normalize("Last_Updated")) return new Date().toISOString();
    if (key === normalize("Google_Calendar_Event_Status")) return status === "Blocked" ? "Blocked by HR Calendar" : "Availability Checked";
    if (key === normalize("Google_Calendar_Event_Error")) return status === "Blocked" ? "The slot is not available for candidate booking." : "";
    return "";
  });
}

/**
 * Converts legacy HR availability into candidate slots. Each saved legacy
 * window is represented by a final-interview slot, but it is only bookable
 * when the assigned HR interviewer's connected Google Calendar is free. Existing
 * unbooked slots are rechecked so a calendar conflict cannot remain open.
 */
export async function synchronizeFinalInterviewSlots({ roleId, hodEmail, availability }: { roleId: string; hodEmail: string; availability: string }): Promise<FinalInterviewSlotSyncResult> {
  const cleanRoleId = text(roleId);
  const configured = [...new Map(expandHodAvailabilitySlots(parseHodAvailabilitySlots(availability), 60)
    .filter((slot) => isCurrentCalendarMonth(slot.date, slot.timezone))
    .map((slot) => [configuredSlotKey(slot), slot])).values()];
  const data = await readSheet("Interview_Slots", "X");
  const roleRows = data.rows
    .map((row, index) => ({ row, rowNumber: data.rowNumbers[index] }))
    .filter(({ row }) => field(row, "Interview_Type", "Interview Type").toLowerCase() === "final interview" && field(row, "Role_ID", "Role ID").toLowerCase() === cleanRoleId.toLowerCase());
  const updates: CellUpdate[] = [];
  const appendValues: string[][] = [];
  const warnings = new Set<string>();
  let created = 0;
  let blocked = 0;
  let unblocked = 0;
  let skipped = 0;

  async function check(slot: ConfiguredInterviewSlot) {
    if (!text(hodEmail)) return { available: false as const, checked: false as const, reason: "not_connected" as const };
    return checkCalendarAvailability({ hodEmail: text(hodEmail), date: slot.date, startTime: slot.startTime, endTime: slot.endTime, timezone: slot.timezone });
  }

  async function applyCalendarState(row: Row, rowNumber: number, slot: ConfiguredInterviewSlot) {
    const currentStatus = field(row, "Status").trim();
    const result = await check(slot);
    if (result.checked && result.available) {
      if (currentStatus.toLowerCase() === "blocked") {
        updates.push(
          { tab: "Interview_Slots", row: rowNumber, header: "Status", value: "Available" },
          { tab: "Interview_Slots", row: rowNumber, header: "Google_Calendar_Event_Status", value: "Availability Checked" },
          { tab: "Interview_Slots", row: rowNumber, header: "Google_Calendar_Event_Error", value: "" },
          { tab: "Interview_Slots", row: rowNumber, header: "Last_Updated", value: new Date().toISOString() },
        );
        unblocked += 1;
      }
      return;
    }
    const reason = calendarBlockReason(result);
    warnings.add(reason);
    if (currentStatus.toLowerCase() !== "blocked") blocked += 1;
    updates.push(
      { tab: "Interview_Slots", row: rowNumber, header: "Status", value: "Blocked" },
      { tab: "Interview_Slots", row: rowNumber, header: "Google_Calendar_Event_Status", value: "Blocked by HR Calendar" },
      { tab: "Interview_Slots", row: rowNumber, header: "Google_Calendar_Event_Error", value: reason },
      { tab: "Interview_Slots", row: rowNumber, header: "Last_Updated", value: new Date().toISOString() },
    );
  }

  for (const { row, rowNumber } of roleRows) {
    const currentStatus = field(row, "Status").trim().toLowerCase();
    const applicationId = field(row, "Application_ID", "Application ID").trim();
    if (currentStatus === "booked" || applicationId) continue;
    const slot = {
      date: field(row, "Date"),
      startTime: field(row, "Start_Time", "Start Time"),
      endTime: field(row, "End_Time", "End Time"),
      timezone: field(row, "Timezone", "Time Zone"),
    };
    if (configured.length === 0 || !slotMatchesHodAvailability(slot, configured)) {
      if (currentStatus !== "blocked") blocked += 1;
      updates.push(
        { tab: "Interview_Slots", row: rowNumber, header: "Status", value: "Blocked" },
        { tab: "Interview_Slots", row: rowNumber, header: "Google_Calendar_Event_Status", value: "Blocked by legacy HR Availability" },
        { tab: "Interview_Slots", row: rowNumber, header: "Google_Calendar_Event_Error", value: "This slot is outside the current legacy HR availability." },
        { tab: "Interview_Slots", row: rowNumber, header: "Last_Updated", value: new Date().toISOString() },
      );
      continue;
    }
    await applyCalendarState(row, rowNumber, slot);
  }

  for (const slot of configured) {
    const existing = roleRows.find(({ row }) => configuredSlotKey({
      date: field(row, "Date"),
      startTime: field(row, "Start_Time", "Start Time"),
      endTime: field(row, "End_Time", "End Time"),
      timezone: field(row, "Timezone", "Time Zone"),
    }) === configuredSlotKey(slot));
    if (existing) {
      skipped += 1;
      continue;
    }
    const result = await check(slot);
    if (result.checked && result.available) {
      appendValues.push(configuredSlotRow(data, slot, cleanRoleId, "Available"));
      created += 1;
    } else {
      const reason = calendarBlockReason(result);
      warnings.add(reason);
      appendValues.push(configuredSlotRow(data, slot, cleanRoleId, "Blocked"));
      blocked += 1;
    }
  }

  if (updates.length > 0) await updateCells(updates);
  if (appendValues.length > 0) await appendRows("Interview_Slots", appendValues);
  return { created, blocked, unblocked, skipped, warnings: [...warnings] };
}

/**
 * n8n owns candidate email delivery and the resume-stage booking invitation.
 * The portal owns final-stage token issuance and booking-link construction;
 * n8n only sends the portal-generated final link after voice approval. Each
 * poller claims work by writing the same columns this function used to set,
 * so writing those claim fields here fought the workflows:
 *
 * - Voice stage: setting `Voice_Approval_Processed` to "Yes" on approval left
 *   Phase 5's filter (which only proceeds while that flag is blank/pending/error)
 *   permanently unsatisfied, so the final-interview email was never sent.
 * - Resume stage: the booking token and link written here were immediately
 *   overwritten by Phase 2, leaving a discarded token and a stale link.
 * - Final stage: the portal creates the single-use token and n8n must not
 *   generate a second token or replace the local-development booking URL.
 *
 * The portal therefore records the HR decision and the human-facing status only.
 * `Final_Status` is safe to write because neither workflow gates on it, and it
 * gives HR immediate feedback before the next poll runs.
 *
 * The final stage has no active n8n owner (Phase 6 is not in production), so the
 * portal still records that outcome itself.
 */
export async function recordApplicantDecision(applicationId: string, stage: ApplicantDecisionStage, decision: ApplicantDecision, reviewer: { name: string; email: string }, comments: string, publicAppBaseUrl = "") {
  if (isPostgresRecruitmentTarget()) {
    if (decision === "No Show") throw new Error("No-show decisions are recorded by the voice retry workflow.");
    return targetRecordApplicantDecision({ applicationId, stage, decision, comments, reviewer });
  }
  const data = await readSheet("High_Match_Profile", "CZ");
  const found = findApplicant(data, applicationId);
  if (!found) throw new Error("Applicant not found.");
  const now = new Date().toISOString();
  const previousFinalStatus = field(found.row, "Final_Status");
  const set = (header: string, value: string): CellUpdate => ({ tab: "High_Match_Profile", row: found.rowNumber, header, value });
  const updates: CellUpdate[] = [set("Last_Updated", now)];
  let newFinalStatus = previousFinalStatus;
  if (stage === "resume") {
    if (decision === "Manual Review") {
      newFinalStatus = "Pending Manual Review";
      updates.push(set("Resume_HR_Decision", decision), set("Resume_HR_Decision_Date", now), set("Resume_HR_Reviewer", reviewer.name), set("Resume_HR_Comments", comments), set("Final_Status", newFinalStatus));
    } else {
      newFinalStatus = decision === "Approve" ? "Approved for AI Voice Interview" : "Resume Rejected";
      updates.push(set("Resume_HR_Decision", decision), set("Resume_HR_Decision_Date", now), set("Resume_HR_Reviewer", reviewer.name), set("Resume_HR_Comments", comments), set("Final_Status", newFinalStatus));
    }
  } else if (stage === "voice") {
    if (decision === "Manual Review") {
      newFinalStatus = "Pending Manual Review";
      updates.push(set("Voice_HR_Decision", decision), set("Voice_HR_Comments", comments), set("Final_Status", newFinalStatus));
    } else {
      newFinalStatus = decision === "Approve" ? "Approved for Final Interview" : "Voice Interview Rejected";
      updates.push(set("Voice_HR_Decision", decision), set("Voice_HR_Comments", comments), set("Final_Status", newFinalStatus));
      if (decision === "Approve" && publicAppBaseUrl) {
        // A prior failed poll can leave this claim flag at Processing. Reset
        // it when HR approves so n8n retries the final-invitation email using
        // the portal-generated link instead of waiting forever.
        updates.push(set("Voice_Approval_Processed", ""));
        const invitation = finalBookingInvitation(found.row, publicAppBaseUrl, await getPortalConfigNumber("Booking_Link_Expiry_Days", 7));
        updates.push(
          set("Final_Interview_Booking_Token", invitation.token),
          set("Final_Interview_Booking_Token_Hash", invitation.tokenHash),
          set("Final_Interview_Booking_Token_Expires_At", invitation.expiresAt),
          set("Final_Interview_Booking_Token_Status", "Pending"),
          set("Final_Interview_Booking_Link", invitation.link),
        );
        // Snapshot the current role venue so n8n's face-to-face invitation
        // email has the address without re-reading Role_Requests.
        const decisionRole = await getRoleRequestById(field(found.row, "Role_ID", "Role ID")).catch(() => null);
        if (decisionRole?.finalInterviewVenue?.trim()) {
          updates.push(set("Final_Interview_Venue", decisionRole.finalInterviewVenue.trim()));
        }
      }
    }
  } else {
    if (decision === "Manual Review") {
      newFinalStatus = "Pending Manual Review";
      updates.push(set("Final_Status", newFinalStatus), set("Final_Interview_Comments", comments));
    } else {
      newFinalStatus = decision === "Approve" ? "Final Interview Passed" : "Final Interview Rejected";
      updates.push(
        set("Status 3 (Final Interview)", "Interview Completed"),
        set("Final_Status", newFinalStatus),
        set("Final_Interview_Comments", comments),
        set("Final_Interview_Reviewer", reviewer.name),
        set("Final_Interview_Decision_Date", now),
      );
      await upsertFinalTracking(found.row, applicationId, decision, reviewer, comments, now);
    }
  }
  await updateCells(updates);
  const historyEntry = buildCandidateStatusHistoryEntry({
    applicationId,
    roleId: field(found.row, "Role_ID", "Role ID"),
    changedAt: now,
    previousStatus: previousFinalStatus,
    newStatus: newFinalStatus || previousFinalStatus,
    stage,
    action: decision,
    changedByName: reviewer.name,
    changedByEmail: reviewer.email,
    comments,
    rejectionReason: decision === "Reject" ? comments : "",
    actionSource: "Applicant Review Portal",
  });
  await appendRows("Candidate_Status_History", [candidateHistoryValues(historyEntry)]);
  return { decision, stage };
}

async function upsertFinalTracking(applicant: Row, applicationId: string, decision: ApplicantDecision, reviewer: { name: string; email: string }, comments: string, now: string) {
  const data = await readSheet("Final_Interview_Tracking", "AE");
  const existingIndex = data.rows.findIndex((row) => field(row, "Application_ID", "Application ID") === applicationId);
  const existing = existingIndex >= 0 ? data.rows[existingIndex] : {};
  const finalInterviewCalendar = await getFinalInterviewCalendarConfig();
  const hrName = finalInterviewCalendar.email ? "HR" : "";
  const hrEmail = finalInterviewCalendar.email;
  const values = data.headers.map((header) => {
    const key = normalize(header);
    if (key === normalize("Application_ID")) return applicationId;
    if (key === normalize("Candidate_Name")) return field(applicant, "Candidate Name");
    if (key === normalize("Candidate_Email")) return field(applicant, "Email");
    if (key === normalize("Contact_Number")) return asTextCell(field(applicant, "Contact Number"));
    if (key === normalize("Role_ID")) return field(applicant, "Role_ID");
    if (key === normalize("Selected_Role")) return field(applicant, "Selected Role");
    if (key === normalize("Department")) return field(applicant, "Department");
    if (key === normalize("Match_Score")) return field(applicant, "Match Score");
    if (key === normalize("Voice_Interview_Score")) return field(applicant, "Voice Score");
    if (key === normalize("Voice_Interview_Summary")) return field(applicant, "AI Voice Summary");
    if (key === normalize("HR_Decision")) return decision;
    if (key === normalize("Final_Recommendation")) return decision === "Approve" ? "Passed" : "Rejected";
    if (["Final_Interview_Comments", "Comments", "HR_Comments", "Decision_Comments"].map(normalize).includes(key)) return comments;
    if (["Reviewed_By", "Reviewer", "HR_Reviewer"].map(normalize).includes(key)) return reviewer.name;
    if (["Decision_Date", "Reviewed_At"].map(normalize).includes(key)) return now;
    if (key === normalize("Last_Updated")) return now;
    if (key === normalize("Interviewer_Name")) return hrName || field(existing, "Interviewer_Name", "Interviewer Name");
    if (key === normalize("Interviewer_Email")) return hrEmail || field(existing, "Interviewer_Email", "Interviewer Email");
    return "";
  });
  if (existingIndex >= 0) {
    const rowNumber = data.rowNumbers[existingIndex];
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `'Final_Interview_Tracking'!A${rowNumber}:${columnName(data.headers.length - 1)}${rowNumber}`, valueInputOption: "USER_ENTERED", requestBody: { values: [values] } });
  } else {
    await sheets.spreadsheets.values.append({ spreadsheetId, range: "'Final_Interview_Tracking'!A1", valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: [values] } });
  }
  invalidateSheetsCache("Final_Interview_Tracking");
}
