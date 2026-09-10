import crypto from "node:crypto";

import {
  getApplication,
  getRole,
  getBookingToken,
  applyHrDecision,
  bookInterviewSlot,
  createApplication,
  createInterviewSlot,
  createScreeningInvitation,
  enqueueBulkScreening,
  getScreeningInvitation,
  listActiveBookingRoleIds,
  listApplicationSlots,
  listApplicationBookingTokens,
  listApplications,
  listRecentApplications,
  listBulkQueueForPortal,
  listBookingSlots,
  listRoleStatusHistory,
  renameRoleExternalId,
  markBookingTokenUsed,
  markInterviewCalendarEvent,
  markScreeningInvitationUsed,
  updateApplicationProfile,
  deleteApplication,
  markInterviewNoShow as markTargetInterviewNoShow,
  listRoles,
  registerResumeFile,
  updateRoleDetails,
  archiveRole,
  calendarEventQueue,
  createBookingToken,
  applicationVoiceReview,
  copyScreeningResult,
} from "@/lib/internal-recruitment-queries";
import { classifyVoiceInterviewBillingOutcome } from "@/lib/ella-credit-math";
import { applicantVoiceTimezone } from "@/lib/applicant-timezone";
import { extractStoredResumeText, type ResumeFileKind, type ResumeFileRecord } from "@/lib/resume-files";
import { scheduledInstant } from "@/lib/interview-time";
import type { RoleRequestDetails, RoleRequestSummary } from "@/lib/google-sheets";
import { applicantStageLabel } from "@/lib/applicant-stage-labels";
import { generateRoleId } from "@/lib/role-id";
import { checkCalendarAvailability, createFinalInterviewEvent, deleteFinalInterviewEvent } from "@/lib/google-calendar";
import { hasValidFutureTime, isBeforeTargetHiringDate, isStandardFinalInterviewSlot, isVirtualSlotId, slotKey, virtualSlotsForRole } from "@/lib/interview-availability-rules";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function jsonText(value: unknown, fallback: unknown) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
}

function listText(value: unknown) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  const raw = text(value);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean).join(", ") : raw;
  } catch {
    return raw;
  }
}

const VOICE_OUTCOME_LABELS: Record<string, string> = {
  no_answer: "No Answer",
  incomplete: "Incomplete",
  completed: "Completed",
};

const RESUME_TEXT_CACHE_TTL_MS = 15 * 60 * 1000;
const RESUME_TEXT_CACHE_MAX_ENTRIES = 32;
const resumeTextCache = new Map<string, { text: string; expiresAt: number }>();
const resumeTextInFlight = new Map<string, Promise<string>>();

function storedResumeRecord(value: Record<string, unknown> | null | undefined): ResumeFileRecord | null {
  if (!value) return null;
  const kind = text(value.kind);
  if (kind !== "pdf" && kind !== "docx" && kind !== "doc") return null;
  return {
    fileId: text(value.storageRef), fileName: text(value.filename), mimeType: text(value.mimeType),
    size: Number(value.size) || 0, sha256: text(value.sha256),
    uploadedAt: value.uploadedAt instanceof Date ? value.uploadedAt.toISOString() : text(value.uploadedAt),
    expiresAt: value.expiresAt instanceof Date ? value.expiresAt.toISOString() : text(value.expiresAt),
    kind: kind as ResumeFileKind,
    extractedText: text(value.extractedText),
  };
}

// The extracted resume text is not persisted; it is re-read from the stored
// file on demand. A missing or expired file is not an error for the HR view.
async function storedResumeText(value: Record<string, unknown> | null | undefined) {
  const record = storedResumeRecord(value);
  if (!record) return "";
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) return "";
  const key = record.fileId;
  const cached = resumeTextCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.text;
  if (cached) resumeTextCache.delete(key);
  const existing = resumeTextInFlight.get(key);
  if (existing) return existing;
  const extraction = extractStoredResumeText(record).catch(() => "");
  resumeTextInFlight.set(key, extraction);
  try {
    const textValue = await extraction;
    if (textValue) {
      resumeTextCache.set(key, { text: textValue, expiresAt: Date.now() + RESUME_TEXT_CACHE_TTL_MS });
      while (resumeTextCache.size > RESUME_TEXT_CACHE_MAX_ENTRIES) {
        const oldest = resumeTextCache.keys().next().value;
        if (!oldest) break;
        resumeTextCache.delete(oldest);
      }
    }
    return textValue;
  } finally {
    resumeTextInFlight.delete(key);
  }
}

function label(value: unknown) {
  return text(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .replace(/\bHr\b/g, "HR")
    .replace(/\bAi\b/g, "AI")
    .replace(/\bHod\b/g, "HOD");
}

function roleSummary(role: Record<string, unknown>): RoleRequestSummary {
  const status = label(role.status || "submitted");
  const setupStatus = label(role.recruitmentSetupStatus || "draft");
  const posted = Boolean(role.postedAt) || role.postingConfirmed === true;
  return {
    roleId: text(role.externalId),
    createdAt: text(role.createdAt),
    requesterEmail: text(role.requesterEmail),
    targetHiringDate: text(role.targetHiringDate),
    requesterName: text(role.requesterName),
    department: text(role.departmentSnapshot),
    requestType: label(role.requestType),
    jobTitle: text(role.title),
    numberOfVacancies: Number(role.vacancies) || 1,
    status,
    applicationLink: text(role.applicationLink),
    recruitmentSetupStatus: setupStatus,
    postingConfirmed: posted ? "TRUE" : "FALSE",
    postedAt: text(role.postedAt),
    jobDescription: text((role.setup as Record<string, unknown> | undefined)?.jobDescription),
    postingChannels: listText((role.setup as Record<string, unknown> | undefined)?.postingChannels),
    hodEmail: text(role.hrCalendarEmail),
    hodAvailabilitySlots: jsonText((role.setup as Record<string, unknown> | undefined)?.hodAvailabilitySlots, []),
    interviewAvailabilityRules: jsonText(role.availabilityRules, []),
    voiceInterviewAvailabilityMode: "",
    voiceInterviewSlots: "",
    voiceInterviewAutoStartDate: "",
    voiceInterviewAutoEndDate: "",
    voiceInterviewTimezone: "",
  };
}

export async function targetRoleSummaries(options: { liveOnly?: boolean } = {}) {
  const roles = (await repairPublishedRoleIds(await listRoles())).filter((role) => !isArchivedRole(role as unknown as Record<string, unknown>));
  const visible = options.liveOnly
    ? roles.filter((role) => ["approved", "recruitment_setup", "job_posted"].includes(text(role.status).toLowerCase()))
    : roles;
  return visible.map((role) => roleSummary(role as unknown as Record<string, unknown>));
}

export async function targetRoleDetails(externalId: string): Promise<RoleRequestDetails | null> {
  const roles = await repairPublishedRoleIds(await listRoles());
  const role = roles.find((candidate) => text(candidate.externalId).toLowerCase() === decodeURIComponent(externalId).trim().toLowerCase());
  if (!role) return null;
  const raw = role as unknown as Record<string, unknown>;
  if (isArchivedRole(raw)) return null;
  const summary = roleSummary(raw);
  const setup = (raw.setup as Record<string, unknown> | undefined) || {};
  return {
    ...summary,
    voiceInterviewAvailabilityMode: text(raw.voiceInterviewAvailabilityMode),
    voiceInterviewSlots: text(raw.voiceInterviewSlots),
    voiceInterviewAutoStartDate: text(raw.voiceInterviewAutoStartDate),
    voiceInterviewAutoEndDate: text(raw.voiceInterviewAutoEndDate),
    voiceInterviewTimezone: text(raw.voiceInterviewTimezone),
    interviewAvailabilityRules: jsonText(raw.availabilityRules, []),
    postingChannels: listText((setup as Record<string, unknown>).postingChannels),
    submittedByEmail: text(raw.submittedByEmail),
    submittedByName: text(raw.requesterName),
    requesterType: "HR or Management",
    reasonForRequest: text(raw.reason),
    jobDescription: text(setup.jobDescription),
    replacementEmployee: text(setup.replacementEmployee),
    hodAvailabilityDates: text(setup.hodAvailabilityDates),
    hodAvailabilityTimes: text(setup.hodAvailabilityTimes),
    hodAvailabilitySlots: jsonText(setup.hodAvailabilitySlots, []),
    voiceInterviewSlotsGeneratedAt: text(setup.voiceInterviewSlotsGeneratedAt),
    customScreeningQuestion1: text(setup.customScreeningQuestion1),
    customScreeningQuestion2: text(setup.customScreeningQuestion2),
    aiGeneratedScreeningQuestions: text(setup.aiGeneratedScreeningQuestions),
    reportingManager: text(setup.reportingManager),
    workLocation: text(setup.workLocation),
    employmentType: text(setup.employmentType) || "Full-Time",
    jobResponsibilities: text(setup.jobResponsibilities),
    requiredSkills: text(setup.requiredSkills),
    experienceRequired: text(setup.experienceRequired),
    educationRequirements: text(setup.educationRequirements),
    preferredQualifications: text(setup.preferredQualifications),
    roleExpectations: text(setup.roleExpectations),
    salaryMin: text(setup.salaryMin),
    salaryMax: text(setup.salaryMax),
    workSchedule: text(setup.workSchedule),
    noticePeriodRequirement: text(setup.noticePeriodRequirement),
    salaryExpectationGuidance: text(setup.salaryExpectationGuidance),
    screeningCriteria: text(setup.screeningCriteria),
    requiredInterviewQuestion1: text(setup.requiredInterviewQuestion1),
    requiredInterviewQuestion2: text(setup.requiredInterviewQuestion2),
    requiredInterviewQuestion3: text(setup.requiredInterviewQuestion3),
    requiredInterviewQuestion4: text(setup.requiredInterviewQuestion4),
    requiredInterviewQuestion5: text(setup.requiredInterviewQuestion5),
    aiSystemPrompt: text(setup.aiSystemPrompt),
    initialInterviewBookingLink: text(setup.initialInterviewBookingLink),
    hodInterviewBookingLink: text(setup.hodInterviewBookingLink),
    licenseOrCertificateRequired: text(setup.licenseOrCertificateRequired),
    evaluationFieldToggles: listText(raw.evaluationFields),
    customEvaluationFields: Array.isArray(raw.evaluationFields) ? raw.evaluationFields as { key: string; label: string; description: string }[] : [],
    salaryDisclosureStatus: text(setup.salaryDisclosureStatus),
    experienceRequirementStatus: text(setup.experienceRequirementStatus),
    licenseRequirementStatus: text(setup.licenseRequirementStatus),
    hodInterviewRequired: text(setup.hodInterviewRequired),
    finalInterviewVenue: text(setup.finalInterviewVenue),
    recruitmentSetupUpdatedAt: text(raw.updatedAt),
    recruitmentSetupUpdatedByName: "",
    recruitmentSetupUpdatedByEmail: text(raw.updatedByEmail),
    minimumYearsOfExperience: text(setup.minimumYearsOfExperience),
    keywordsToLookFor: text(setup.keywordsToLookFor),
    transferableSkillsAccepted: text(setup.transferableSkillsAccepted),
    salaryOrBudgetRange: text(setup.salaryOrBudgetRange),
    earliestAvailabilityRule: text(setup.earliestAvailabilityRule),
    interviewBehavior: "",
    approvedBy: text(raw.approvedBy),
    approvedAt: text(raw.approvedAt),
    managementComments: "",
    latestComments: text(raw.latestComments),
    resumeTargetStatus: "",
    lastUpdatedAt: text(raw.updatedAt),
    lastUpdatedByName: "",
    lastUpdatedByEmail: text(raw.updatedByEmail),
    source: text(raw.source),
  };
}

function isArchivedRole(role: Record<string, unknown>) {
  const archive = role.archive;
  return Boolean(archive && typeof archive === "object" && text((archive as Record<string, unknown>).archivedAt));
}

/** Repair published rows created before temporary draft IDs were promoted. */
async function repairPublishedRoleIds(sourceRoles: Awaited<ReturnType<typeof listRoles>>) {
  const usedIds = sourceRoles.map((role) => text(role.externalId));
  const repaired = [];
  for (const role of sourceRoles) {
    const externalId = text(role.externalId);
    if (text(role.status).toLowerCase() !== "job_posted" || !externalId.startsWith("DRAFT-")) {
      repaired.push(role);
      continue;
    }
    const nextExternalId = generateRoleId(text(role.title), usedIds);
    const result = await renameRoleExternalId({ currentExternalId: externalId, nextExternalId, actorEmail: "system:published-role-id-repair" });
    if (result.renamed) {
      usedIds.push(nextExternalId);
      repaired.push({ ...role, externalId: nextExternalId });
    } else {
      repaired.push(role);
    }
  }
  return repaired;
}

export async function targetRoleStatusHistory(externalId: string) {
  const rows = await listRoleStatusHistory(externalId);
  return rows.map(({ history, roleExternalId }) => ({
    historyId: history.id,
    roleId: roleExternalId,
    changedAt: text(history.changedAt),
    changedByName: text(history.changedByName),
    changedByEmail: text(history.changedByEmail),
    previousStatus: label(history.previousStatus),
    newStatus: label(history.newStatus),
    comments: text(history.comments),
    actionSource: text(history.actionSource),
    actionRequestId: text(history.actionRequestId),
    action: text(history.action),
    accessRole: text(history.accessRole),
    department: text(history.department),
    resumeTargetStatus: "",
    notificationStatus: text(history.notificationStatus),
    notificationError: text(history.notificationError),
  }));
}

function slotDateTime(value: unknown, timezone: string) {
  const parsed = value instanceof Date ? value : new Date(text(value));
  if (Number.isNaN(parsed.getTime())) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function bookingSlot(slot: Record<string, unknown>, roleExternalId = "") {
  const timezone = text(slot.timezone) || "Asia/Singapore";
  const startsAt = slotDateTime(slot.startsAt, timezone);
  const endsAt = slotDateTime(slot.endsAt, timezone);
  return {
    slotId: text(slot.id), interviewType: text(slot.interviewType) === "voice" ? "AI Voice Interview" : "Final Interview", roleId: roleExternalId,
    date: startsAt.date, startTime: startsAt.time, endTime: endsAt.time, timezone, status: label(slot.status),
    applicationId: text(slot.applicationId), candidateName: text(slot.candidateName), candidateEmail: text(slot.candidateEmail), bookedAt: text(slot.bookedAt),
    calendarEventId: text(slot.calendarEventId), calendarEventLink: text(slot.calendarEventLink), calendarEventStatus: text(slot.calendarEventStatus), calendarEventError: text(slot.calendarEventError),
  };
}

export async function targetBookingContext(kind: "voice" | "final", tokenHash: string) {
  const token = await getBookingToken(tokenHash);
  if (!token || token.token.kind !== kind || ["used", "booked", "expired", "revoked"].includes(text(token.token.status).toLowerCase()) || (token.token.expiresAt && token.token.expiresAt.getTime() < Date.now())) return null;
  const row = await getApplication(token.applicationExternalId);
  if (!row) return null;
  const slots = await listApplicationSlots(token.applicationExternalId);
  const roleId = text(row.roleExternalId);
  const targetType = kind === "voice" ? "voice" : "final";
  const role = await targetRoleDetails(roleId);
  const matching = slots.map(({ slot }) => bookingSlot(slot as unknown as Record<string, unknown>, roleId)).filter((slot) => text(slot.interviewType).toLowerCase().includes(targetType));
  const currentSlot = matching.find((slot) => ["booked", "completed", "no show"].includes(text(slot.status).toLowerCase()));
  const availableRows = await listBookingSlots(targetType, roleId);
  const persistedAvailable = availableRows
    .map((value) => bookingSlot(((value as { slot?: unknown }).slot || value) as Record<string, unknown>, roleId))
    .filter((slot) => isBeforeTargetHiringDate(slot.date, row.roleTargetHiringDate || undefined))
    .filter((slot) => hasValidFutureTime(slot));
  const persistedKeys = new Set(persistedAvailable.map((slot) => slotKey(slot)));
  // The AI voice interview is a phone call to the candidate, so its offered
  // times follow the candidate's own country timezone. The face-to-face
  // interview stays in the office timezone.
  const voiceTimezone = kind === "voice"
    ? applicantVoiceTimezone({ country: text(row.application.applicantCountry), phone: text(row.application.preferredMobile || row.application.phone) })
    : undefined;
  const virtualAvailable = role
    ? virtualSlotsForRole(role, kind === "voice" ? "AI Voice Interview" : "Final Interview", true, voiceTimezone)
      .filter((slot) => !persistedKeys.has(slotKey(slot)))
      .filter((slot) => hasValidFutureTime(slot))
      .map((slot) => ({ ...slot, roleId, status: "Available" as const }))
    : [];
  const available = [...persistedAvailable, ...virtualAvailable].sort((left, right) => `${left.date} ${left.startTime}`.localeCompare(`${right.date} ${right.startTime}`));
  const roleSetup = row.roleSetup && typeof row.roleSetup === "object" ? row.roleSetup as Record<string, unknown> : {};
  return {
    kind, applicationId: text(row.application.externalId), candidateName: text(row.application.candidateName), email: text(row.application.email || row.applicantEmail),
    selectedRole: text(row.roleTitle), roleId, bookingStatus: text(token.token.status), scheduledDate: text(currentSlot?.date), scheduledTime: text(currentSlot?.startTime),
    timezone: text(currentSlot?.timezone), appliedAt: text(row.application.appliedAt), preferredMobile: text(row.application.preferredMobile || row.application.phone),
    finalInterviewVenue: text(roleSetup.finalInterviewVenue), roleHrCalendarEmail: text(row.roleHrCalendarEmail), currentSlot, slots: available,
  };
}

export async function targetReserveBooking(kind: "voice" | "final", tokenHash: string, slotId: string, actorEmail: string) {
  const context = await targetBookingContext(kind, tokenHash);
  if (!context) return { booked: false, error: "invalid_booking_token" as const };
  let persistedSlotId = slotId;
  const virtualSlot = isVirtualSlotId(slotId) ? context.slots.find((slot) => slot.slotId === slotId) : undefined;
  if (virtualSlot) {
    const materialized = await targetCreateInterviewSlot({
      slotCode: kind === "final" ? virtualSlot.slotId : undefined,
      roleId: context.roleId,
      interviewType: kind === "voice" ? "AI Voice Interview" : "Final Interview",
      date: virtualSlot.date,
      startTime: virtualSlot.startTime,
      endTime: virtualSlot.endTime,
      timezone: virtualSlot.timezone,
    });
    if (!materialized.slot) return { booked: false, error: materialized.error || "slot_unavailable" as const };
    persistedSlotId = materialized.slot.id;
  }
  const result = await bookInterviewSlot({ slotId: persistedSlotId, applicationExternalId: context.applicationId, actorEmail, actionRequestId: `booking:${tokenHash}:${slotId}` });
  if (!result.booked) return result;
  if (!result.slot) return { booked: false, error: "booking_missing_slot" as const };
  await markBookingTokenUsed(tokenHash);
  if (kind !== "final") return result;

  const slot = result.slot;
  const timezone = text(slot.timezone) || "Asia/Singapore";
  const startsAt = slotDateTime(slot.startsAt, timezone);
  const endsAt = slotDateTime(slot.endsAt, timezone);
  let calendar: Awaited<ReturnType<typeof createFinalInterviewEvent>>;
  try {
    calendar = await createFinalInterviewEvent({
      hodEmail: context.roleHrCalendarEmail,
      summary: `HR Interview: ${context.candidateName} — ${context.selectedRole}`,
      description: `HR interview for ${context.candidateName} (${context.applicationId}) applying for ${context.selectedRole}.\n\nCandidate email: ${context.email}${context.finalInterviewVenue ? `\n\nVenue:\n${context.finalInterviewVenue}` : ""}`,
      date: startsAt.date,
      startTime: `${startsAt.time}:00`,
      endTime: `${endsAt.time}:00`,
      timezone,
      attendeeEmails: [context.email],
      location: context.finalInterviewVenue,
    });
  } catch (error) {
    calendar = { created: false, reason: "error", error: error instanceof Error ? error.message : String(error) };
  }
  try {
    await markInterviewCalendarEvent({
      slotId: slot.id,
      status: calendar.created ? "created" : "failed",
      eventId: calendar.created ? calendar.eventId : undefined,
      eventLink: calendar.created ? calendar.htmlLink : undefined,
      error: calendar.created ? undefined : ("error" in calendar ? calendar.error : calendar.reason),
    });
  } catch (error) {
    calendar = calendar.created
      ? { created: false, reason: "error", error: `Calendar event created but write-back failed: ${error instanceof Error ? error.message : String(error)}` }
      : { ...calendar, error: `${"error" in calendar && calendar.error ? calendar.error : calendar.reason}; write-back failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { ...result, calendar };
}

/** Retry Calendar writes for bookings that survived a transient provider or
 * deployment failure. The direct booking path already attempts this inline;
 * this worker closes the gap for failed attempts and legacy queued bookings. */
export async function processTargetCalendarEventQueue(limit = 10) {
  const rows = (await calendarEventQueue()).slice(0, Math.max(1, Math.min(10, Math.trunc(limit))));
  const results = [];
  for (const row of rows) {
    const timezone = text(row.timezone) || "Asia/Singapore";
    const startsAt = slotDateTime(row.startsAt, timezone);
    const endsAt = slotDateTime(row.endsAt, timezone);
    if (!startsAt.date || new Date(String(row.startsAt)).getTime() <= Date.now()) {
      const marked = await markInterviewCalendarEvent({ slotId: row.id, status: "skipped", error: "The scheduled interview time has already passed." });
      results.push({ slotId: row.id, status: "skipped", updated: marked.updated });
      continue;
    }
    const setup = row.roleSetup && typeof row.roleSetup === "object" ? row.roleSetup as Record<string, unknown> : {};
    let calendar: Awaited<ReturnType<typeof createFinalInterviewEvent>>;
    try {
      calendar = await createFinalInterviewEvent({
        hodEmail: text(row.roleHrCalendarEmail),
        summary: `HR Interview: ${text(row.candidateName) || "Candidate"} — ${text(row.roleExternalId)}`,
        description: `HR interview for ${text(row.candidateName) || "Candidate"} (${text(row.applicationExternalId)}).${text(row.candidateEmail) ? `\n\nCandidate email: ${text(row.candidateEmail)}` : ""}`,
        date: startsAt.date,
        startTime: `${startsAt.time}:00`,
        endTime: `${endsAt.time}:00`,
        timezone,
        attendeeEmails: text(row.candidateEmail) ? [text(row.candidateEmail)] : [],
        location: text(setup.finalInterviewVenue),
      });
    } catch (error) {
      calendar = { created: false, reason: "error", error: error instanceof Error ? error.message : String(error) };
    }
    const marked = await markInterviewCalendarEvent({
      slotId: row.id,
      status: calendar.created ? "created" : "failed",
      eventId: calendar.created ? calendar.eventId : undefined,
      eventLink: calendar.created ? calendar.htmlLink : undefined,
      error: calendar.created ? undefined : ("error" in calendar ? calendar.error : calendar.reason),
    });
    results.push({ slotId: row.id, status: calendar.created ? "created" : "failed", updated: marked.updated, error: "error" in calendar ? calendar.error : undefined });
  }
  return { processed: results.length, results };
}

export async function targetCreateInterviewSlot(input: { slotCode?: string; roleId: string; interviewType: "AI Voice Interview" | "Final Interview"; date: string; startTime: string; endTime: string; timezone: string }) {
  let startsAt: string;
  let endsAt: string;
  try {
    // Store the absolute instant represented by the candidate's local time.
    // Appending `Z` here would silently reinterpret Manila/Kuala Lumpur/etc.
    // times as UTC and can move a call several hours from its booking.
    startsAt = scheduledInstant(input.date, input.startTime, input.timezone).toISOString();
    endsAt = scheduledInstant(input.date, input.endTime, input.timezone).toISOString();
  } catch {
    return { slot: null, created: false, error: "invalid_slot" as const };
  }
  if (input.interviewType === "Final Interview") {
    const role = await getRole(input.roleId);
    if (!role) return { slot: null, created: false, error: "unknown_role" as const };
    if (!["approved", "recruitment_setup", "job_posted"].includes(text(role.status).toLowerCase())) return { slot: null, created: false, error: "role_not_ready" as const };
    if (!isStandardFinalInterviewSlot({ interviewType: input.interviewType, startTime: input.startTime, endTime: input.endTime })) return { slot: null, created: false, error: "invalid_final_slot" as const };
    if (!isBeforeTargetHiringDate(input.date, role.targetHiringDate || undefined)) return { slot: null, created: false, error: "after_target_hiring_date" as const };
    const start = new Date(startsAt);
    if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) return { slot: null, created: false, error: "past_slot" as const };
    const calendar = await checkCalendarAvailability({ hodEmail: text(role.hrCalendarEmail), date: input.date, startTime: input.startTime, endTime: input.endTime, timezone: input.timezone });
    if (!calendar.checked) return { slot: null, created: false, error: calendar.reason === "not_connected" ? "calendar_not_connected" as const : "calendar_unavailable" as const };
    if (!calendar.available) return { slot: null, created: false, error: "calendar_conflict" as const };
  }
  return createInterviewSlot({ slotCode: input.slotCode, roleExternalId: input.roleId, interviewType: input.interviewType.toLowerCase().includes("voice") ? "voice" : "final", startsAt, endsAt, timezone: input.timezone });
}

export async function targetUpdateApplicantProfile(input: { applicationId: string; candidateName: string; email: string; preferredMobile: string; applicantCountry: string }) {
  return updateApplicationProfile({ externalId: input.applicationId, candidateName: input.candidateName, phone: input.preferredMobile, preferredMobile: input.preferredMobile, applicantCountry: input.applicantCountry });
}

export async function targetRecordApplicantDecision(input: { applicationId: string; stage: "resume" | "voice" | "final"; decision: string; comments: string; reviewer: { name: string; email: string } }) {
  const result = await applyHrDecision({ applicationExternalId: input.applicationId, stage: input.stage, decision: input.decision === "Approve" ? "approve" : input.decision === "Reject" ? "reject" : input.decision === "Manual Review" ? "manual_review" : "pending", comments: input.comments, actorEmail: input.reviewer.email, actorName: input.reviewer.name, actionRequestId: `portal-decision:${input.applicationId}:${input.stage}:${input.decision}:${input.reviewer.email}` });
  if (!result.updated && !("duplicate" in result && result.duplicate)) throw new Error(result.error || "Unable to record the applicant decision.");
  // Issue the voice booking invitation as part of the approval request. The
  // n8n poller remains a recovery path, while this idempotent write removes
  // the race where approval and the five-minute poll run at the same time.
  if (input.stage === "resume" && input.decision === "Approve") {
    const invitation = await createBookingToken({
      applicationExternalId: input.applicationId,
      kind: "voice",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (!invitation.token) throw new Error(invitation.error || "Unable to create the voice interview booking invitation.");
    return { ...result, voiceBookingInvitationQueued: true, voiceBookingNotificationHistoryId: invitation.notificationHistoryId };
  }
  // Approving the voice interview must invite the candidate to book the
  // face-to-face (HR) interview, the same way resume approval invites the
  // voice interview. Without this the candidate is moved to
  // "approved_for_final" but never receives a booking link.
  if (input.stage === "voice" && input.decision === "Approve") {
    const invitation = await createBookingToken({
      applicationExternalId: input.applicationId,
      kind: "final",
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (!invitation.token) throw new Error(invitation.error || "Unable to create the face-to-face interview booking invitation.");
    return { ...result, finalBookingInvitationQueued: true, finalBookingNotificationHistoryId: invitation.notificationHistoryId };
  }
  return result;
}

export async function targetCreateScreeningInvitation(input: { roleId: string; candidateEmail: string; createdBy: string; expiresAt?: string }) {
  const token = crypto.randomBytes(32).toString("hex");
  const result = await createScreeningInvitation({ roleExternalId: input.roleId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), email: input.candidateEmail, createdBy: input.createdBy, expiresAt: input.expiresAt });
  if (!result.invitation) throw new Error(result.error || "Unable to create screening invitation.");
  return { invitationId: result.invitation.id, token, expiresAt: result.invitation.expiresAt?.toISOString() || "" };
}

export async function targetCreateApplication(input: { externalId: string; roleId: string; candidateName: string; email: string; phone: string; preferredMobile: string; applicantCountry: string; source: string; sourceDetail?: string; consentAt?: string; resume?: { fileId: string; fileName: string; mimeType: string; size: number; sha256: string; kind: string; expiresAt: string; extractedText?: string } }) {
  const resumeFileId = input.resume ? await registerResumeFile({ storageRef: input.resume.fileId, sha256: input.resume.sha256, filename: input.resume.fileName, mimeType: input.resume.mimeType, size: input.resume.size, kind: input.resume.kind, expiresAt: input.resume.expiresAt, extractedText: input.resume.extractedText }) : null;
  const result = await createApplication({ externalId: input.externalId, roleExternalId: input.roleId, applicantEmail: input.email, applicantName: input.candidateName, phone: input.phone, preferredMobile: input.preferredMobile, applicantCountry: input.applicantCountry, source: input.source, sourceDetail: input.sourceDetail, consentAt: input.consentAt, resumeFileId: resumeFileId || undefined });
  if (!result.application) throw new Error(result.error || "Unable to create the application.");
  if (input.resume) {
    const queued = await enqueueBulkScreening({
      applicationExternalId: result.application.externalId,
      roleExternalId: input.roleId,
      dedupeKey: result.application.externalId,
      resumeSha256: input.resume.sha256,
      driveFileId: input.resume.fileId,
      filename: input.resume.fileName,
      mimeType: input.resume.mimeType,
      candidateName: input.candidateName,
      candidateEmail: input.email,
      preferredMobile: input.preferredMobile,
      applicantCountry: input.applicantCountry,
      source: "upload",
      environment: "pilot",
      isUat: true,
    });
    if (queued.error) throw new Error(queued.error);
    const screeningReused = !queued.created && queued.item?.status === "screened" && Boolean(queued.item.applicationId)
      ? await copyScreeningResult({ sourceApplicationId: queued.item.applicationId as string, targetApplicationId: result.application.id })
      : false;
    return { ...result, screeningQueued: queued.created, screeningQueueCreated: queued.created, screeningReused };
  }
  return { ...result, screeningQueued: false, screeningQueueCreated: false, screeningReused: false };
}

export async function targetGetScreeningInvitation(token: string) {
  const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");
  const row = await getScreeningInvitation(tokenHash);
  if (!row) return null;
  const expiresAt = row.invitation.expiresAt;
  const expired = Boolean(expiresAt && expiresAt.getTime() < Date.now());
  const valid = row.invitation.status === "active" && !expired;
  return { invitationId: row.invitation.id, roleId: row.roleExternalId, roleTitle: row.roleTitle, candidateName: "", candidateEmail: row.invitation.email, status: row.invitation.status, applicationId: "", expiresAt: expiresAt?.toISOString() || "", valid, reason: valid ? undefined : expired ? "expired" as const : row.invitation.status === "used" ? "used" as const : "invalid" as const };
}

export async function targetUseScreeningInvitation(token: string, applicationId: string) {
  const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");
  return markScreeningInvitationUsed(tokenHash, applicationId);
}

export async function targetUpdateRoleFields(roleId: string, fields: Record<string, string>) {
  const setup = {
    jobDescription: fields.Job_Description,
    screeningCriteria: fields.Screening_Criteria,
    requiredInterviewQuestion1: fields.Required_Interview_Question_1,
    requiredInterviewQuestion2: fields.Required_Interview_Question_2,
    requiredInterviewQuestion3: fields.Required_Interview_Question_3,
    requiredInterviewQuestion4: fields.Required_Interview_Question_4,
    requiredInterviewQuestion5: fields.Required_Interview_Question_5,
    keywordsToLookFor: fields.Keywords_to_Look_For,
    minimumYearsOfExperience: fields.Minimum_Years_of_Experience,
    transferableSkillsAccepted: fields.Transferable_Skills_Accepted,
    licenseOrCertificateRequired: fields.License_or_Certificate_Required,
    salaryOrBudgetRange: fields.Salary_or_Budget_Range,
    earliestAvailabilityRule: fields.Earliest_Availability_Rule,
    postingChannels: fields.Posting_Channels,
    aiSystemPrompt: fields.AI_System_Prompt,
    voiceInterviewAvailabilityMode: fields.Voice_Interview_Availability_Mode,
    voiceInterviewSlots: fields.Voice_Interview_Slots,
    voiceInterviewAutoStartDate: fields.Voice_Interview_Auto_Start_Date,
    voiceInterviewAutoEndDate: fields.Voice_Interview_Auto_End_Date,
    voiceInterviewTimezone: fields.Voice_Interview_Timezone,
    replacementEmployee: fields.Replacement_Employee,
    employmentType: fields.Employment_Type,
    hodAvailabilityDates: fields.HOD_Availability_Dates,
    hodAvailabilityTimes: fields.HOD_Availability_Times,
    hodAvailabilitySlots: fields.HOD_Availability_Slots,
    customScreeningQuestion1: fields.Custom_Screening_Question_1,
    customScreeningQuestion2: fields.Custom_Screening_Question_2,
    aiGeneratedScreeningQuestions: fields.AI_Screening_Questions,
    reportingManager: fields.Reporting_Manager,
    workLocation: fields.Work_Location,
    jobResponsibilities: fields.Job_Responsibilities,
    requiredSkills: fields.Required_Skills,
    experienceRequired: fields.Experience_Required,
    educationRequirements: fields.Education_Requirements,
    preferredQualifications: fields.Preferred_Qualifications,
    roleExpectations: fields.Role_Expectations,
    salaryMin: fields.Salary_Minimum,
    salaryMax: fields.Salary_Maximum,
    workSchedule: fields.Work_Schedule,
    noticePeriodRequirement: fields.Notice_Period_Requirement,
    salaryExpectationGuidance: fields.Salary_Expectation_Guidance,
    interviewBehavior: fields.Interview_Behavior,
    initialInterviewBookingLink: fields.Initial_Interview_Booking_Link,
    hodInterviewBookingLink: fields.HOD_Interview_Booking_Link,
    salaryDisclosureStatus: fields.Salary_Disclosure_Status,
    experienceRequirementStatus: fields.Experience_Requirement_Status,
    licenseRequirementStatus: fields.License_Requirement_Status,
    hodInterviewRequired: fields.HOD_Interview_Required,
    finalInterviewVenue: fields.Final_Interview_Venue,
    voiceInterviewSlotsGeneratedAt: fields.Voice_Interview_Slots_Generated_At,
  };
  let availabilityRules: unknown = undefined;
  try { if (fields.Interview_Availability_Rules) availabilityRules = JSON.parse(fields.Interview_Availability_Rules); } catch { availabilityRules = []; }
  let evaluationFields: unknown = undefined;
  try { if (fields.Evaluation_Fields) evaluationFields = JSON.parse(fields.Evaluation_Fields); } catch { evaluationFields = []; }
  return updateRoleDetails({
    externalId: roleId,
    status: normalizeTargetRoleStatus(fields.Status) || (["true", "1", "yes"].includes(text(fields.Posting_Confirmed).toLowerCase()) ? "job_posted" : undefined),
    title: fields.Job_Title,
    departmentSnapshot: fields.Department,
    requestType: fields.Request_Type,
    vacancies: Number(fields.Number_Of_Vacancies) || 1,
    reason: fields.Reason_For_Request,
    targetHiringDate: fields.Target_Hiring_Date || null,
    recruitmentSetupStatus: text(fields.Recruitment_Setup_Status).toLowerCase().replaceAll(" ", "_") || undefined,
    setup,
    evaluationFields,
    availabilityRules,
    hrCalendarEmail: fields.HOD_Email,
    applicationLink: fields.Application_Link,
    postedAt: fields.Posted_At || undefined,
    postedBy: fields.Posted_By,
    postingConfirmed: fields.Posting_Confirmed ? ["true", "1", "yes"].includes(fields.Posting_Confirmed.toLowerCase()) : undefined,
    approvedBy: fields.Approved_By,
    approvedAt: fields.Approved_At || undefined,
    latestComments: fields.Comments || fields.Latest_Comments,
    actionRequestId: fields.Action_Request_ID || undefined,
    actorName: fields.Last_Updated_By_Name || fields.Changed_By_Name,
    action: fields.Action || "role_updated",
    actorEmail: fields.Last_Updated_By_Email || fields.Requester_Email || "",
  });
}

function normalizeTargetRoleStatus(value?: string) {
  const key = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  const statuses: Record<string, string> = {
    draft: "draft",
    pending_hr_discussion: "pending_hr_discussion",
    approved: "approved",
    recruitment_setup: "recruitment_setup",
    job_posted: "job_posted",
    returned_for_revision: "returned_for_revision",
    on_hold: "on_hold",
    rejected: "rejected",
    archived: "archived",
  };
  return statuses[key] || "";
}

export async function targetArchiveRole(roleId: string, actor: { email: string; name?: string }) {
  return archiveRole({ externalId: roleId, actorEmail: actor.email, actorName: actor.name, actionRequestId: `archive:${roleId}` });
}

type TargetApplicationRow = Awaited<ReturnType<typeof listApplications>>[number];

function targetApplicantSummary(row: TargetApplicationRow) {
    const application = row.application as unknown as Record<string, unknown>;
    const screening = row.screeningResult as unknown as Record<string, unknown> | null;
    return {
      applicationId: text(application.externalId),
      candidateName: text(application.candidateName),
      email: text(application.email || row.applicantEmail),
      contactNumber: text(application.phone),
      roleId: text(row.roleExternalId),
      selectedRole: text(row.roleTitle),
      department: text(row.departmentSnapshot),
      appliedAt: text(application.appliedAt),
      matchScore: screening?.matchScore == null ? "" : String(screening.matchScore),
      recommendation: label(application.currentStage),
      cvRecommendation: text(screening?.recommendation || application.resumeHrDecision),
      resumeStatus: text(application.resumeHrDecision || (screening ? "Processed" : "")),
      voiceStatus: text(application.voiceHrDecision),
      finalInterviewStatus: text(application.finalHrDecision),
      finalStatus: label(application.currentStage),
      currentStage: text(application.currentStage),
      nextAction: label(application.currentStage),
      isHistoricalDemo: false,
    };
}

export async function targetApplicantSummaries() {
  const rows = await listApplications();
  return rows.map(targetApplicantSummary);
}

export async function targetRecentApplicantSummaries(department = "") {
  const rows = await listRecentApplications(department || undefined, 50);
  return rows.map(targetApplicantSummary);
}

export async function targetDeleteApplicant(externalId: string) {
  const row = await getApplication(externalId);
  if (!row) return { deleted: false, error: "unknown_application" as const };
  const slots = await listApplicationSlots(externalId);
  const finalBookedSlots = slots
    .map(({ slot }) => slot as unknown as Record<string, unknown>)
    .filter((slot) => text(slot.interviewType) === "final" && text(slot.status) === "booked" && text(slot.calendarEventId));
  for (const slot of finalBookedSlots) {
    const calendarResult = await deleteFinalInterviewEvent(text(row.roleHrCalendarEmail), text(slot.calendarEventId), { allowDemoSideEffect: true });
    if (!calendarResult.deleted) {
      return { deleted: false, error: "calendar_event_delete_failed" as const };
    }
  }
  return deleteApplication(externalId);
}

export async function targetMarkInterviewNoShow(slotId: string, actor: { email: string; name: string }) {
  return markTargetInterviewNoShow(slotId, actor.email, actor.name);
}

export async function targetApplicantMetrics(rows?: Awaited<ReturnType<typeof targetApplicantSummaries>>) {
  const summaries = rows || await targetApplicantSummaries();
  const stageCounts = new Map<string, number>();
  for (const row of summaries) stageCounts.set(row.currentStage, (stageCounts.get(row.currentStage) || 0) + 1);
  const stage = (key: string) => stageCounts.get(key) || 0;
  return {
    total: summaries.length,
    today: summaries.filter((row) => text(row.appliedAt).slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
    screened: summaries.filter((row) => Boolean(row.cvRecommendation || row.resumeStatus)).length,
    interviewed: summaries.filter((row) => ["voice_review_pending", "approved_for_final", "final_scheduled", "final_decision_pending", "passed_final"].includes(row.currentStage)).length,
    voiceActivity: summaries.filter((row) => Boolean(row.voiceStatus)).length,
    hrActivity: summaries.filter((row) => Boolean(row.cvRecommendation || row.voiceStatus || row.finalInterviewStatus)).length,
    resumeApproved: stage("resume_approved"),
    voiceBookingPending: stage("voice_booking_pending"),
    voiceScheduled: stage("voice_scheduled"),
    voiceReviewPending: stage("voice_review_pending"),
    approvedForFinal: stage("approved_for_final"),
    finalScheduled: stage("final_scheduled"),
    finalDecisionPending: stage("final_decision_pending"),
    rejected: stage("rejected"),
    passedFinalInterview: stage("passed_final"),
    stageCounts: [
      ["resume_review", applicantStageLabel("resume_review"), "blue"], ["resume_approved", applicantStageLabel("resume_approved"), "purple"],
      ["voice_booking_pending", applicantStageLabel("voice_booking_pending"), "purple"], ["voice_scheduled", applicantStageLabel("voice_scheduled"), "teal"],
      ["voice_review_pending", applicantStageLabel("voice_review_pending"), "orange"], ["approved_for_final", applicantStageLabel("approved_for_final"), "green"],
      ["final_scheduled", applicantStageLabel("final_scheduled"), "teal"], ["final_decision_pending", applicantStageLabel("final_decision_pending"), "orange"],
      ["passed_final", applicantStageLabel("passed_final"), "green"], ["rejected", applicantStageLabel("rejected"), "red"],
    ].map(([key, label, tone]) => ({ key, label, tone, value: stage(key) })),
  };
}

export async function targetApplicantDetails(externalId: string) {
  const row = await getApplication(externalId);
  if (!row) return null;
  const summary = targetApplicantSummary(row);
  const application = row.application as unknown as Record<string, unknown>;
  const screening = row.screeningResult as unknown as Record<string, unknown> | null;
  const resumeFile = row.resumeFile as unknown as Record<string, unknown> | null;
  const slots = await listApplicationSlots(externalId);
  const tokens = await listApplicationBookingTokens(externalId);
  const voiceSlot = slots.map(({ slot }) => slot as unknown as Record<string, unknown>).find((slot) => text(slot.interviewType) === "voice");
  const finalSlot = slots.map(({ slot }) => slot as unknown as Record<string, unknown>).find((slot) => text(slot.interviewType) === "final");
  const voiceToken = tokens.find((token) => token.kind === "voice");
  const finalToken = tokens.find((token) => token.kind === "final");
  const date = (value: unknown) => value instanceof Date ? value.toISOString() : text(value);
  const voiceTimezone = text(voiceSlot?.timezone) || "Asia/Singapore";
  const finalSlotTimezone = text(finalSlot?.timezone) || "Asia/Singapore";
  const voiceStartsAt = voiceSlot ? slotDateTime(voiceSlot.startsAt, voiceTimezone) : { date: "", time: "" };
  const finalStartsAt = finalSlot ? slotDateTime(finalSlot.startsAt, finalSlotTimezone) : { date: "", time: "" };
  const voiceReview = await applicationVoiceReview(externalId);
  const voiceResult = voiceReview?.result ?? null;
  const voiceLog = voiceReview?.log ?? null;
  const voiceAttempt = voiceReview?.attempt ?? null;
  const voiceOutcome = voiceResult || voiceAttempt
    ? classifyVoiceInterviewBillingOutcome({
        outcome: text(voiceAttempt?.outcome),
        callStatus: text(voiceResult?.callStatus),
        callFinalStatus: text(voiceResult?.callFinalStatus),
        transcript: text(voiceResult?.transcript || voiceLog?.transcript),
      })
    : null;
  const voiceCallStatus = voiceOutcome
    ? VOICE_OUTCOME_LABELS[voiceOutcome]
    : voiceResult
      ? "Completed"
      : summary.currentStage === "voice_review_pending"
        ? "Awaiting Review"
        : "";
  const resumeText = await storedResumeText(resumeFile);
  return {
    ...summary,
    roleDetails: await targetRoleDetails(row.roleExternalId),
    aiAnalysisSummary: text(screening?.summary),
    interviewQuestions: text(screening?.interviewQuestions),
    resumeText,
    resumeFileId: text(resumeFile?.storageRef),
    resumeFileName: text(resumeFile?.filename),
    resumeFileMimeType: text(resumeFile?.mimeType),
    resumeFileExpiresAt: date(resumeFile?.expiresAt),
    strengths: text(screening?.strengths),
    gaps: text(screening?.gaps),
    resumeDecision: text(application.resumeHrDecision),
    resumeDecisionDate: date(application.resumeHrDecisionAt),
    resumeReviewer: text(application.resumeHrReviewer),
    resumeComments: text(application.resumeHrComments),
    resumeEvaluationFields: [],
    voiceDecision: text(application.voiceHrDecision),
    voiceComments: text(application.voiceHrComments),
    voiceScore: voiceResult?.score == null ? "" : String(voiceResult.score),
    voiceRecommendation: text(voiceResult?.recommendation || voiceLog?.recommendation),
    voiceSummary: text(voiceResult?.summary || voiceLog?.summary),
    voiceStrengths: text(voiceResult?.strengths),
    voiceConcerns: text(voiceResult?.concerns),
    voiceCommunicationQuality: voiceLog?.communicationScore == null ? "" : String(voiceLog.communicationScore),
    voiceAnswerCompleteness: voiceLog?.completenessScore == null ? "" : String(voiceLog.completenessScore),
    voiceFollowUpQuestions: text(voiceLog?.followUpQuestions),
    voiceEvaluationFields: [],
    voiceTranscript: text(voiceResult?.transcript || voiceLog?.transcript),
    voiceCallStatus,
    voiceScheduledDate: voiceStartsAt.date,
    voiceScheduledTime: voiceStartsAt.time,
    voiceTimezone: voiceSlot ? voiceTimezone : "",
    interviewSlot: voiceSlot ? { timezone: voiceTimezone, status: label(voiceSlot.status) } : undefined,
    voiceBookingStatus: label(voiceToken?.status || voiceSlot?.status),
    voiceBookingLink: text(voiceToken?.link),
    bookingTokenStatus: text(voiceToken?.status),
    bookingTokenExpiresAt: date(voiceToken?.expiresAt),
    finalBookingStatus: label(finalToken?.status || finalSlot?.status),
    finalScheduledDate: finalStartsAt.date,
    finalScheduledTime: finalStartsAt.time,
    finalTimezone: finalSlot ? finalSlotTimezone : "",
    finalBookingLink: text(finalToken?.link),
    finalBookingTokenExpiresAt: date(finalToken?.expiresAt),
    finalComments: text(application.finalInterviewComments),
    lastUpdated: date(application.updatedAt),
  };
}

export async function targetActiveBookingLinkRoleIds() {
  const rows = await listActiveBookingRoleIds();
  return {
    voice: rows.filter((row) => row.kind === "voice").map((row) => text(row.roleExternalId)),
    final: rows.filter((row) => row.kind === "final").map((row) => text(row.roleExternalId)),
  };
}

export async function targetBulkResumeQueue(roleExternalId = "") {
  const rows = await listBulkQueueForPortal(undefined, roleExternalId || undefined);
  return rows.map(({ item, roleExternalId: roleId, applicationExternalId }) => ({
    driveFileId: text(item.driveFileId), driveFileName: text(item.filename), driveFileUrl: text(item.fileUrl), roleId: text(roleId),
    candidateName: text(item.candidateName), candidateEmail: text(item.candidateEmail), status: label(item.status), applicationId: text(applicationExternalId),
    errorMessage: text(item.errorMessage), discoveredAt: text(item.discoveredAt), processingStartedAt: text(item.processingStartedAt), processedAt: text(item.processedAt),
    attemptCount: String(item.attemptCount ?? 0), lastUpdated: text(item.updatedAt), environment: text(item.environment), isUat: Boolean(item.isUat), batchId: text(item.batchId), jobId: text(item.jobId),
  }));
}

export async function targetAppendBulkResumeQueue(event: { driveFileId: string; roleId: string; status: string; driveFileName?: string; driveFileUrl?: string; driveFileMimeType?: string; candidateName?: string; candidateEmail?: string; applicationId?: string; errorMessage?: string; discoveredAt?: string; processingStartedAt?: string; processedAt?: string; attemptCount?: string; lastUpdated?: string; environment?: string; isUat?: boolean; batchId?: string; jobId?: string; resumeSha256?: string }) {
  const resumeSha256 = text(event.resumeSha256) || crypto.createHash("sha256").update(event.driveFileId).digest("hex");
  const result = await enqueueBulkScreening({ roleExternalId: event.roleId, dedupeKey: event.driveFileId, resumeSha256, driveFileId: event.driveFileId, filename: event.driveFileName || event.driveFileId, fileUrl: event.driveFileUrl, mimeType: event.driveFileMimeType, candidateName: event.candidateName, candidateEmail: event.candidateEmail, environment: event.environment, isUat: event.isUat, batchId: event.batchId, jobId: event.jobId, source: "upload" });
  if (!result.item) throw new Error(result.error || "Unable to save target bulk queue item.");
  return { created: result.created, item: result.item };
}

export async function targetBookings() {
  const rows = await listBookingSlots();
  return rows.map((row) => {
    const slot = (row as { slot?: Record<string, unknown> }).slot || row as unknown as Record<string, unknown>;
    const timezone = text(slot.timezone) || "Asia/Singapore";
    const startsAt = slotDateTime(slot.startsAt, timezone);
    const endsAt = slotDateTime(slot.endsAt, timezone);
    return { slotId: text(slot.id), interviewType: text(slot.interviewType), roleId: text((row as { roleExternalId?: string }).roleExternalId), date: startsAt.date, startTime: startsAt.time, endTime: endsAt.time, timezone, status: label(slot.status), applicationId: text(slot.applicationId), candidateName: text(slot.candidateName), candidateEmail: text(slot.candidateEmail), bookedAt: text(slot.bookedAt), lastUpdated: text(slot.updatedAt), calendarEventId: text(slot.calendarEventId), calendarEventLink: text(slot.calendarEventLink), calendarEventStatus: text(slot.calendarEventStatus), calendarEventError: text(slot.calendarEventError) };
  });
}
