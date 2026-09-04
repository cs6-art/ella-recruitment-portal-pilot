import crypto from "node:crypto";

import {
  getApplication,
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
  listApplications,
  listBulkQueueForPortal,
  listBookingSlots,
  listRoleStatusHistory,
  markBookingTokenUsed,
  markScreeningInvitationUsed,
  updateApplicationProfile,
  listRoles,
  registerResumeFile,
  updateRoleDetails,
} from "@/lib/internal-recruitment-queries";
import type { RoleRequestDetails, RoleRequestSummary } from "@/lib/google-sheets";

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

function label(value: unknown) {
  return text(value).replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
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
    postingChannels: jsonText((role.setup as Record<string, unknown> | undefined)?.postingChannels, []),
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
  const roles = await listRoles();
  const visible = options.liveOnly
    ? roles.filter((role) => ["approved", "recruitment_setup", "job_posted"].includes(text(role.status).toLowerCase()))
    : roles;
  return visible.map((role) => roleSummary(role as unknown as Record<string, unknown>));
}

export async function targetRoleDetails(externalId: string): Promise<RoleRequestDetails | null> {
  const roles = await listRoles();
  const role = roles.find((candidate) => text(candidate.externalId).toLowerCase() === decodeURIComponent(externalId).trim().toLowerCase());
  if (!role) return null;
  const raw = role as unknown as Record<string, unknown>;
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
    postingChannels: jsonText((setup as Record<string, unknown>).postingChannels, []),
    submittedByEmail: text(raw.submittedByEmail),
    submittedByName: text(raw.requesterName),
    requesterType: "HR or Management",
    reasonForRequest: text(raw.reason),
    jobDescription: text(setup.jobDescription),
    replacementEmployee: "",
    hodAvailabilityDates: "",
    hodAvailabilityTimes: "",
    voiceInterviewSlotsGeneratedAt: "",
    customScreeningQuestion1: "",
    customScreeningQuestion2: "",
    aiGeneratedScreeningQuestions: "",
    reportingManager: "",
    workLocation: "",
    employmentType: "",
    jobResponsibilities: "",
    requiredSkills: "",
    experienceRequired: "",
    educationRequirements: "",
    preferredQualifications: "",
    roleExpectations: "",
    salaryMin: "",
    salaryMax: "",
    workSchedule: "",
    noticePeriodRequirement: "",
    salaryExpectationGuidance: "",
    screeningCriteria: text(setup.screeningCriteria),
    requiredInterviewQuestion1: text(setup.requiredInterviewQuestion1),
    requiredInterviewQuestion2: text(setup.requiredInterviewQuestion2),
    requiredInterviewQuestion3: text(setup.requiredInterviewQuestion3),
    requiredInterviewQuestion4: text(setup.requiredInterviewQuestion4),
    requiredInterviewQuestion5: text(setup.requiredInterviewQuestion5),
    aiSystemPrompt: text(setup.aiSystemPrompt),
    initialInterviewBookingLink: "",
    hodInterviewBookingLink: "",
    licenseOrCertificateRequired: text(setup.licenseOrCertificateRequired),
    evaluationFieldToggles: jsonText(raw.evaluationFields, []),
    customEvaluationFields: Array.isArray(raw.evaluationFields) ? raw.evaluationFields as { key: string; label: string; description: string }[] : [],
    salaryDisclosureStatus: "",
    experienceRequirementStatus: "",
    licenseRequirementStatus: "",
    hodInterviewRequired: "",
    finalInterviewVenue: "",
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

export async function targetRoleStatusHistory(externalId: string) {
  const rows = await listRoleStatusHistory(externalId);
  return rows.map(({ history, roleExternalId }) => ({
    historyId: history.id,
    roleId: roleExternalId,
    changedAt: text(history.changedAt),
    changedByName: text(history.changedByName),
    changedByEmail: text(history.changedByEmail),
    previousStatus: text(history.previousStatus),
    newStatus: text(history.newStatus),
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

function bookingSlot(slot: Record<string, unknown>, roleExternalId = "") {
  const startsAt = text(slot.startsAt);
  const endsAt = text(slot.endsAt);
  return {
    slotId: text(slot.id), interviewType: text(slot.interviewType) === "voice" ? "AI Voice Interview" : "Final Interview", roleId: roleExternalId,
    date: startsAt.slice(0, 10), startTime: startsAt.slice(11, 16), endTime: endsAt.slice(11, 16), timezone: text(slot.timezone), status: label(slot.status),
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
  const matching = slots.map(({ slot }) => bookingSlot(slot as unknown as Record<string, unknown>, roleId)).filter((slot) => text(slot.interviewType).toLowerCase().includes(targetType));
  const currentSlot = matching.find((slot) => ["booked", "completed", "no show"].includes(text(slot.status).toLowerCase()));
  const availableRows = await listBookingSlots(targetType, roleId);
  const available = availableRows.map((value) => bookingSlot(((value as { slot?: unknown }).slot || value) as Record<string, unknown>, roleId));
  return {
    kind, applicationId: text(row.application.externalId), candidateName: text(row.application.candidateName), email: text(row.application.email || row.applicantEmail),
    selectedRole: text(row.roleTitle), roleId, bookingStatus: text(token.token.status), scheduledDate: text(currentSlot?.date), scheduledTime: text(currentSlot?.startTime),
    timezone: text(currentSlot?.timezone), appliedAt: text(row.application.appliedAt), preferredMobile: text(row.application.preferredMobile || row.application.phone), currentSlot, slots: available,
  };
}

export async function targetReserveBooking(kind: "voice" | "final", tokenHash: string, slotId: string, actorEmail: string) {
  const context = await targetBookingContext(kind, tokenHash);
  if (!context) return { booked: false, error: "invalid_booking_token" as const };
  const result = await bookInterviewSlot({ slotId, applicationExternalId: context.applicationId, actorEmail, actionRequestId: `booking:${tokenHash}:${slotId}` });
  if (result.booked) await markBookingTokenUsed(tokenHash);
  return result;
}

export async function targetCreateInterviewSlot(input: { roleId: string; interviewType: "AI Voice Interview" | "Final Interview"; date: string; startTime: string; endTime: string; timezone: string }) {
  return createInterviewSlot({ roleExternalId: input.roleId, interviewType: input.interviewType.toLowerCase().includes("voice") ? "voice" : "final", startsAt: `${input.date}T${input.startTime}:00${input.timezone === "Asia/Singapore" ? "+08:00" : "Z"}`, endsAt: `${input.date}T${input.endTime}:00${input.timezone === "Asia/Singapore" ? "+08:00" : "Z"}`, timezone: input.timezone });
}

export async function targetUpdateApplicantProfile(input: { applicationId: string; candidateName: string; email: string; preferredMobile: string; applicantCountry: string }) {
  return updateApplicationProfile({ externalId: input.applicationId, candidateName: input.candidateName, phone: input.preferredMobile, preferredMobile: input.preferredMobile, applicantCountry: input.applicantCountry });
}

export async function targetRecordApplicantDecision(input: { applicationId: string; stage: "resume" | "voice" | "final"; decision: string; comments: string; reviewer: { name: string; email: string } }) {
  const result = await applyHrDecision({ applicationExternalId: input.applicationId, stage: input.stage, decision: input.decision === "Approve" ? "approve" : input.decision === "Reject" ? "reject" : input.decision === "Manual Review" ? "manual_review" : "pending", comments: input.comments, actorEmail: input.reviewer.email, actorName: input.reviewer.name, actionRequestId: `portal-decision:${input.applicationId}:${input.stage}:${input.decision}:${input.reviewer.email}` });
  if (!result.updated && !("duplicate" in result && result.duplicate)) throw new Error(result.error || "Unable to record the applicant decision.");
  return result;
}

export async function targetCreateScreeningInvitation(input: { roleId: string; candidateEmail: string; createdBy: string; expiresAt?: string }) {
  const token = crypto.randomBytes(32).toString("hex");
  const result = await createScreeningInvitation({ roleExternalId: input.roleId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), email: input.candidateEmail, createdBy: input.createdBy, expiresAt: input.expiresAt });
  if (!result.invitation) throw new Error(result.error || "Unable to create screening invitation.");
  return { invitationId: result.invitation.id, token, expiresAt: result.invitation.expiresAt?.toISOString() || "" };
}

export async function targetCreateApplication(input: { externalId: string; roleId: string; candidateName: string; email: string; phone: string; preferredMobile: string; applicantCountry: string; source: string; sourceDetail?: string; consentAt?: string; resume?: { fileId: string; fileName: string; mimeType: string; size: number; sha256: string; kind: string; expiresAt: string } }) {
  const resumeFileId = input.resume ? await registerResumeFile({ storageRef: input.resume.fileId, sha256: input.resume.sha256, filename: input.resume.fileName, mimeType: input.resume.mimeType, size: input.resume.size, kind: input.resume.kind, expiresAt: input.resume.expiresAt }) : null;
  const result = await createApplication({ externalId: input.externalId, roleExternalId: input.roleId, applicantEmail: input.email, applicantName: input.candidateName, phone: input.phone, preferredMobile: input.preferredMobile, applicantCountry: input.applicantCountry, source: input.source, sourceDetail: input.sourceDetail, consentAt: input.consentAt, resumeFileId: resumeFileId || undefined });
  if (!result.application) throw new Error(result.error || "Unable to create the application.");
  return result;
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
  };
  let availabilityRules: unknown = undefined;
  try { if (fields.Interview_Availability_Rules) availabilityRules = JSON.parse(fields.Interview_Availability_Rules); } catch { availabilityRules = []; }
  return updateRoleDetails({
    externalId: roleId,
    status: fields.Status || (["true", "1", "yes"].includes(text(fields.Posting_Confirmed).toLowerCase()) ? "job_posted" : undefined),
    title: fields.Job_Title,
    departmentSnapshot: fields.Department,
    requestType: fields.Request_Type,
    vacancies: Number(fields.Number_Of_Vacancies) || 1,
    reason: fields.Reason_For_Request,
    targetHiringDate: fields.Target_Hiring_Date || null,
    recruitmentSetupStatus: text(fields.Recruitment_Setup_Status).toLowerCase().replaceAll(" ", "_") || undefined,
    setup,
    availabilityRules,
    hrCalendarEmail: fields.HOD_Email,
    applicationLink: fields.Application_Link,
    postedAt: fields.Posted_At || undefined,
    postedBy: fields.Posted_By,
    postingConfirmed: fields.Posting_Confirmed ? ["true", "1", "yes"].includes(fields.Posting_Confirmed.toLowerCase()) : undefined,
    approvedBy: fields.Approved_By,
    approvedAt: fields.Approved_At || undefined,
    actorEmail: fields.Last_Updated_By_Email || fields.Requester_Email || "",
  });
}

export async function targetApplicantSummaries() {
  const rows = await listApplications();
  return rows.map((row) => {
    const application = row.application as unknown as Record<string, unknown>;
    return {
      applicationId: text(application.externalId),
      candidateName: text(application.candidateName),
      email: text(application.email || row.applicantEmail),
      contactNumber: text(application.phone),
      roleId: text(row.roleExternalId),
      selectedRole: text(row.roleTitle),
      department: text(row.departmentSnapshot),
      appliedAt: text(application.appliedAt),
      matchScore: "",
      recommendation: label(application.currentStage),
      cvRecommendation: text(application.resumeHrDecision),
      resumeStatus: text(application.resumeHrDecision),
      voiceStatus: text(application.voiceHrDecision),
      finalInterviewStatus: text(application.finalHrDecision),
      finalStatus: label(application.currentStage),
      currentStage: text(application.currentStage),
      nextAction: label(application.currentStage),
    };
  });
}

export async function targetApplicantMetrics() {
  const rows = await targetApplicantSummaries();
  const stageCounts = new Map<string, number>();
  for (const row of rows) stageCounts.set(row.currentStage, (stageCounts.get(row.currentStage) || 0) + 1);
  const stage = (key: string) => stageCounts.get(key) || 0;
  return {
    total: rows.length,
    today: rows.filter((row) => text(row.appliedAt).slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
    screened: rows.filter((row) => Boolean(row.cvRecommendation || row.resumeStatus)).length,
    interviewed: rows.filter((row) => ["voice_review_pending", "approved_for_final", "final_scheduled", "final_decision_pending", "passed_final"].includes(row.currentStage)).length,
    voiceActivity: rows.filter((row) => Boolean(row.voiceStatus)).length,
    hrActivity: rows.filter((row) => Boolean(row.cvRecommendation || row.voiceStatus || row.finalInterviewStatus)).length,
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
      ["resume_review", "Resume Review", "blue"], ["resume_approved", "Resume Approved", "purple"],
      ["voice_booking_pending", "Voice Booking Pending", "purple"], ["voice_scheduled", "Voice Scheduled", "teal"],
      ["voice_review_pending", "Voice Review Pending", "orange"], ["approved_for_final", "Approved For Final", "green"],
      ["final_scheduled", "Final Scheduled", "teal"], ["final_decision_pending", "Final Decision Pending", "orange"],
      ["passed_final", "Passed Final", "green"], ["rejected", "Rejected", "red"],
    ].map(([key, label, tone]) => ({ key, label, tone, value: stage(key) })),
  };
}

export async function targetApplicantDetails(externalId: string) {
  const row = await getApplication(externalId);
  if (!row) return null;
  const [summary] = (await targetApplicantSummaries()).filter((candidate) => candidate.applicationId === externalId);
  return summary ? { ...summary, roleDetails: await targetRoleDetails(row.roleExternalId), aiAnalysisSummary: "", interviewQuestions: "", resumeText: "", resumeFileId: "", resumeFileName: "", resumeFileMimeType: "", resumeFileExpiresAt: "", strengths: "", gaps: "", resumeDecision: "", resumeDecisionDate: "", resumeReviewer: "", resumeComments: "", resumeEvaluationFields: [], voiceDecision: "", voiceComments: "", voiceScore: "", voiceRecommendation: "", voiceSummary: "", voiceStrengths: "", voiceConcerns: "", voiceCommunicationQuality: "", voiceAnswerCompleteness: "", voiceFollowUpQuestions: "", voiceEvaluationFields: [], voiceTranscript: "", voiceScheduledDate: "", voiceScheduledTime: "", voiceBookingStatus: "", voiceBookingLink: "", bookingTokenStatus: "", bookingTokenExpiresAt: "", finalBookingStatus: "", finalScheduledDate: "", finalScheduledTime: "", finalTimezone: "", finalBookingLink: "", finalBookingTokenExpiresAt: "", finalComments: "", lastUpdated: text((row.application as unknown as Record<string, unknown>).updatedAt) } : null;
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
    return { slotId: text(slot.id), interviewType: text(slot.interviewType), roleId: text((row as { roleExternalId?: string }).roleExternalId), date: text(slot.startsAt).slice(0, 10), startTime: text(slot.startsAt).slice(11, 16), endTime: text(slot.endsAt).slice(11, 16), timezone: text(slot.timezone), status: label(slot.status), applicationId: text(slot.applicationId), candidateName: text(slot.candidateName), candidateEmail: text(slot.candidateEmail), bookedAt: text(slot.bookedAt), lastUpdated: text(slot.updatedAt), calendarEventId: text(slot.calendarEventId), calendarEventLink: text(slot.calendarEventLink), calendarEventStatus: text(slot.calendarEventStatus), calendarEventError: text(slot.calendarEventError) };
  });
}
