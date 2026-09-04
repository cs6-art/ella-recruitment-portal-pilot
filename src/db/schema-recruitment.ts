import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Recruitment-core Drizzle schema — mirrors drizzle/0003_recruitment_core.sql.
 *
 * DRAFT / not live. These tables exist so the internal API and backfill/parity
 * tooling can be written and type-checked now; no portal or n8n path reads or
 * writes them until an entity is explicitly migrated (see
 * docs/DATABASE-MIGRATION-PLAN.md phases C+). applicants (person) is separate
 * from applications (person -> role). `updatedAt` is app-maintained.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const departments = pgTable("departments", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull().unique(),
    fullName: text("full_name").notNull().default(""),
    accessRole: text("access_role").notNull().default(""),
    departmentId: uuid("department_id").references(() => departments.id),
    canCreateRole: boolean("can_create_role").notNull().default(false),
    canReviewRole: boolean("can_review_role").notNull().default(false),
    canApproveRole: boolean("can_approve_role").notNull().default(false),
    canEditSettings: boolean("can_edit_settings").notNull().default(false),
    canManageUsers: boolean("can_manage_users").notNull().default(false),
    canReviewDepartmentRole: boolean("can_review_department_role").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("users_active_idx").on(t.active), index("users_department_id_idx").on(t.departmentId)],
);

export const oauthConnections = pgTable("oauth_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  userEmail: text("user_email").notNull(),
  provider: text("provider").notNull(),
  accessTokenEnc: text("access_token_enc").notNull().default(""),
  refreshTokenEnc: text("refresh_token_enc").notNull().default(""),
  tokenExpiresAt: ts("token_expires_at"),
  scope: text("scope").notNull().default(""),
  accountEmail: text("account_email").notNull().default(""),
  connectedAt: ts("connected_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
});

export const portalSettings = pgTable("portal_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  category: text("category").notNull().default(""),
  updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  updatedBy: text("updated_by").notNull().default(""),
});

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    externalId: text("external_id").notNull().unique(),
    code: text("code").unique(),
    title: text("title").notNull().default(""),
    departmentId: uuid("department_id").references(() => departments.id),
    departmentSnapshot: text("department_snapshot").notNull().default(""),
    requestType: text("request_type").notNull().default(""),
    vacancies: integer("vacancies").notNull().default(1),
    reason: text("reason").notNull().default(""),
    targetHiringDate: date("target_hiring_date"),
    status: text("status").notNull().default("draft"),
    recruitmentSetupStatus: text("recruitment_setup_status").notNull().default("draft"),
    requesterUserId: uuid("requester_user_id").references(() => users.id),
    requesterEmail: text("requester_email").notNull().default(""),
    requesterName: text("requester_name").notNull().default(""),
    submittedByEmail: text("submitted_by_email").notNull().default(""),
    hrCalendarEmail: text("hr_calendar_email").notNull().default(""),
    applicationLink: text("application_link").notNull().default(""),
    postedAt: ts("posted_at"),
    postedBy: text("posted_by").notNull().default(""),
    postingConfirmed: boolean("posting_confirmed").notNull().default(false),
    latestComments: text("latest_comments").notNull().default(""),
    approvedBy: text("approved_by").notNull().default(""),
    approvedAt: ts("approved_at"),
    setup: jsonb("setup").notNull().default({}),
    evaluationFields: jsonb("evaluation_fields").notNull().default([]),
    availabilityRules: jsonb("availability_rules").notNull().default([]),
    archive: jsonb("archive").notNull().default({}),
    source: text("source").notNull().default(""),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
    updatedByEmail: text("updated_by_email").notNull().default(""),
  },
  (t) => [
    index("roles_status_idx").on(t.status),
    index("roles_department_id_idx").on(t.departmentId),
    index("roles_requester_email_idx").on(t.requesterEmail),
    index("roles_created_at_idx").on(t.createdAt),
  ],
);

export const roleStatusHistory = pgTable(
  "role_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roleId: uuid("role_id").notNull().references(() => roles.id),
    changedAt: ts("changed_at").notNull().defaultNow(),
    changedByName: text("changed_by_name").notNull().default(""),
    changedByEmail: text("changed_by_email").notNull().default(""),
    previousStatus: text("previous_status").notNull().default(""),
    newStatus: text("new_status").notNull().default(""),
    comments: text("comments").notNull().default(""),
    action: text("action").notNull().default(""),
    actionSource: text("action_source").notNull().default(""),
    actionRequestId: text("action_request_id").unique(),
    accessRole: text("access_role").notNull().default(""),
    department: text("department").notNull().default(""),
    notificationStatus: text("notification_status").notNull().default(""),
    notificationError: text("notification_error").notNull().default(""),
  },
  (t) => [index("role_status_history_role_id_changed_at_idx").on(t.roleId, t.changedAt)],
);

export const applicants = pgTable(
  "applicants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    primaryEmail: text("primary_email").notNull().unique(),
    fullName: text("full_name").notNull().default(""),
    phoneE164: text("phone_e164").notNull().default(""),
    country: text("country").notNull().default(""),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
    notes: text("notes").notNull().default(""),
  },
  (t) => [index("applicants_phone_e164_idx").on(t.phoneE164)],
);

export const applicantAliases = pgTable("applicant_aliases", {
  id: uuid("id").defaultRandom().primaryKey(),
  applicantId: uuid("applicant_id").notNull().references(() => applicants.id),
  kind: text("kind").notNull(),
  value: text("value").notNull(),
  source: text("source").notNull().default(""),
  firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
});

export const resumeFiles = pgTable(
  "resume_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storageRef: text("storage_ref").notNull().unique(),
    sha256: text("sha256").notNull().default(""),
    filename: text("filename").notNull().default(""),
    mimeType: text("mime_type").notNull().default(""),
    size: integer("size").notNull().default(0),
    kind: text("kind").notNull().default(""),
    textExtracted: boolean("text_extracted").notNull().default(false),
    uploadedAt: ts("uploaded_at").notNull().defaultNow(),
    expiresAt: ts("expires_at"),
  },
  (t) => [index("resume_files_sha256_idx").on(t.sha256)],
);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    externalId: text("external_id").notNull().unique(),
    applicantId: uuid("applicant_id").notNull().references(() => applicants.id),
    roleId: uuid("role_id").notNull().references(() => roles.id),
    source: text("source").notNull().default(""),
    sourceDetail: text("source_detail").notNull().default(""),
    appliedAt: ts("applied_at").notNull().defaultNow(),
    consentAt: ts("consent_at"),
    resumeFileId: uuid("resume_file_id").references(() => resumeFiles.id),
    departmentSnapshot: text("department_snapshot").notNull().default(""),
    currentStage: text("current_stage").notNull().default("resume_review"),
    withdrawn: boolean("withdrawn").notNull().default(false),
    candidateName: text("candidate_name").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    preferredMobile: text("preferred_mobile").notNull().default(""),
    applicantCountry: text("applicant_country").notNull().default(""),
    resumeHrDecision: text("resume_hr_decision").notNull().default(""),
    resumeHrDecisionAt: ts("resume_hr_decision_at"),
    resumeHrReviewer: text("resume_hr_reviewer").notNull().default(""),
    resumeHrComments: text("resume_hr_comments").notNull().default(""),
    voiceHrDecision: text("voice_hr_decision").notNull().default(""),
    voiceHrComments: text("voice_hr_comments").notNull().default(""),
    finalHrDecision: text("final_hr_decision").notNull().default(""),
    finalInterviewComments: text("final_interview_comments").notNull().default(""),
    finalInterviewVenue: text("final_interview_venue").notNull().default(""),
    legacyStatus: jsonb("legacy_status").notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("applications_role_id_idx").on(t.roleId),
    index("applications_applicant_id_idx").on(t.applicantId),
    index("applications_current_stage_idx").on(t.currentStage),
    index("applications_applied_at_idx").on(t.appliedAt),
    index("applications_role_stage_idx").on(t.roleId, t.currentStage),
  ],
);

export const screeningResults = pgTable(
  "screening_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id").notNull().unique().references(() => applications.id),
    matchScore: integer("match_score"),
    recommendation: text("recommendation").notNull().default(""),
    summary: text("summary").notNull().default(""),
    strengths: text("strengths").notNull().default(""),
    gaps: text("gaps").notNull().default(""),
    interviewQuestions: text("interview_questions").notNull().default(""),
    evaluationScores: jsonb("evaluation_scores").notNull().default([]),
    screenedAt: ts("screened_at"),
    raw: jsonb("raw"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("screening_results_match_score_idx").on(t.matchScore)],
);

export const screeningInvitations = pgTable(
  "screening_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roleId: uuid("role_id").notNull().references(() => roles.id),
    tokenHash: text("token_hash").notNull().unique(),
    email: text("email").notNull().default(""),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull().default(""),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at"),
    usedAt: ts("used_at"),
    applicationId: uuid("application_id").references(() => applications.id),
  },
  (t) => [index("screening_invitations_role_id_idx").on(t.roleId)],
);

export const bulkScreeningQueueItems = pgTable(
  "bulk_screening_queue_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: text("batch_id").notNull().default(""),
    roleId: uuid("role_id").notNull().references(() => roles.id),
    dedupeKey: text("dedupe_key").notNull(),
    resumeSha256: text("resume_sha256").notNull().default(""),
    driveFileId: text("drive_file_id").notNull().default(""),
    filename: text("filename").notNull().default(""),
    fileUrl: text("file_url").notNull().default(""),
    mimeType: text("mime_type").notNull().default(""),
    status: text("status").notNull().default("queued"),
    applicationId: uuid("application_id").references(() => applications.id),
    candidateName: text("candidate_name").notNull().default(""),
    candidateEmail: text("candidate_email").notNull().default(""),
    preferredMobile: text("preferred_mobile").notNull().default(""),
    applicantCountry: text("applicant_country").notNull().default(""),
    errorMessage: text("error_message").notNull().default(""),
    attemptCount: integer("attempt_count").notNull().default(0),
    source: text("source").notNull().default(""),
    environment: text("environment").notNull().default(""),
    isUat: boolean("is_uat").notNull().default(false),
    jobId: text("job_id").notNull().default(""),
    discoveredAt: ts("discovered_at").notNull().defaultNow(),
    processingStartedAt: ts("processing_started_at"),
    processedAt: ts("processed_at"),
    updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("bulk_queue_batch_id_idx").on(t.batchId), index("bulk_queue_role_status_idx").on(t.roleId, t.status)],
);

export const interviewSlots = pgTable(
  "interview_slots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slotCode: text("slot_code").unique(),
    interviewType: text("interview_type").notNull(),
    roleId: uuid("role_id").references(() => roles.id),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    timezone: text("timezone").notNull().default(""),
    status: text("status").notNull().default("available"),
    applicationId: uuid("application_id").references(() => applications.id),
    candidateName: text("candidate_name").notNull().default(""),
    candidateEmail: text("candidate_email").notNull().default(""),
    bookedAt: ts("booked_at"),
    interviewerName: text("interviewer_name").notNull().default(""),
    interviewerEmail: text("interviewer_email").notNull().default(""),
    hodName: text("hod_name").notNull().default(""),
    hodEmail: text("hod_email").notNull().default(""),
    calendarEventId: text("calendar_event_id").notNull().default(""),
    calendarEventLink: text("calendar_event_link").notNull().default(""),
    calendarEventStatus: text("calendar_event_status").notNull().default(""),
    calendarEventError: text("calendar_event_error").notNull().default(""),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("interview_slots_role_type_status_idx").on(t.roleId, t.interviewType, t.status),
    index("interview_slots_starts_at_idx").on(t.startsAt),
    index("interview_slots_application_id_idx").on(t.applicationId),
  ],
);

export const voiceCallAttempts = pgTable(
  "voice_call_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id").notNull().references(() => applications.id),
    roleId: uuid("role_id").references(() => roles.id),
    attemptNumber: integer("attempt_number").notNull().default(1),
    maxAttempts: integer("max_attempts").notNull().default(3),
    scheduledAt: ts("scheduled_at"),
    retryAfter: ts("retry_after"),
    status: text("status").notNull().default("scheduled"),
    outcome: text("outcome"),
    preferredMobile: text("preferred_mobile").notNull().default(""),
    contactNumber: text("contact_number").notNull().default(""),
    applicantCountry: text("applicant_country").notNull().default(""),
    providerCallId: text("provider_call_id").notNull().default(""),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("voice_call_attempts_application_id_idx").on(t.applicationId),
    index("voice_call_attempts_status_idx").on(t.status),
    index("voice_call_attempts_scheduled_at_idx").on(t.scheduledAt),
  ],
);

export const voiceInterviewResults = pgTable(
  "voice_interview_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id").notNull().references(() => applications.id),
    attemptId: uuid("attempt_id").references(() => voiceCallAttempts.id),
    score: integer("score"),
    recommendation: text("recommendation").notNull().default(""),
    strengths: text("strengths").notNull().default(""),
    concerns: text("concerns").notNull().default(""),
    summary: text("summary").notNull().default(""),
    transcript: text("transcript").notNull().default(""),
    evaluationScores: jsonb("evaluation_scores").notNull().default([]),
    callStatus: text("call_status").notNull().default(""),
    callFinalStatus: text("call_final_status").notNull().default(""),
    providerEventType: text("provider_event_type").notNull().default(""),
    resultReceivedAt: ts("result_received_at"),
    callCompletedAt: ts("call_completed_at"),
    raw: jsonb("raw"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("voice_interview_results_application_id_created_at_idx").on(t.applicationId, t.createdAt)],
);

export const voiceCallLogs = pgTable(
  "voice_call_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id").notNull().references(() => applications.id),
    voiceCallAttemptId: uuid("voice_call_attempt_id").references(() => voiceCallAttempts.id),
    provider: text("provider").notNull().default(""),
    providerCallId: text("provider_call_id").notNull().default(""),
    providerEventId: text("provider_event_id").notNull().default(""),
    sourceEventKey: text("source_event_key").notNull().unique(),
    callStatus: text("call_status").notNull().default(""),
    durationSeconds: integer("duration_seconds"),
    recordingUrl: text("recording_url").notNull().default(""),
    communicationScore: integer("communication_score"),
    completenessScore: integer("completeness_score"),
    followUpQuestions: text("follow_up_questions").notNull().default(""),
    transcript: text("transcript").notNull().default(""),
    summary: text("summary").notNull().default(""),
    recommendation: text("recommendation").notNull().default(""),
    errorDetails: text("error_details").notNull().default(""),
    rawResult: jsonb("raw_result"),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("voice_call_logs_application_id_idx").on(t.applicationId, t.startedAt),
    index("voice_call_logs_provider_call_id_idx").on(t.provider, t.providerCallId),
    index("voice_call_logs_provider_event_id_idx").on(t.provider, t.providerEventId),
  ],
);

export const bookingTokens = pgTable(
  "booking_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id").notNull().references(() => applications.id),
    kind: text("kind").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status").notNull().default("pending"),
    expiresAt: ts("expires_at"),
    usedAt: ts("used_at"),
    link: text("link").notNull().default(""),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("booking_tokens_application_id_kind_idx").on(t.applicationId, t.kind)],
);

export const applicationStatusHistory = pgTable(
  "application_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id").notNull().references(() => applications.id),
    changedAt: ts("changed_at").notNull().defaultNow(),
    stage: text("stage").notNull().default(""),
    previousStage: text("previous_stage").notNull().default(""),
    newStage: text("new_stage").notNull().default(""),
    decision: text("decision").notNull().default(""),
    actorName: text("actor_name").notNull().default(""),
    actorEmail: text("actor_email").notNull().default(""),
    comments: text("comments").notNull().default(""),
    source: text("source").notNull().default(""),
    actionRequestId: text("action_request_id").unique(),
    notificationStatus: text("notification_status").notNull().default(""),
    notificationError: text("notification_error").notNull().default(""),
  },
  (t) => [index("application_status_history_application_id_changed_at_idx").on(t.applicationId, t.changedAt)],
);
