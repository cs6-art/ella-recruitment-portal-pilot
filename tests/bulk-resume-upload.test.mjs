import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const root = path.dirname(fileURLToPath(import.meta.url));
function read(relativePath) {
  return readFileSync(path.join(root, "..", relativePath), "utf8");
}

test("bulk resume upload processes files with bounded, configurable concurrency instead of one at a time", () => {
  // The batch pipeline is the shared intake helper used by both local upload
  // and Google Drive import.
  const route = read("src/lib/bulk-resume-intake.ts");
  // Concurrency comes from portal config (Settings sheet value overrides the
  // BULK_RESUME_UPLOAD_CONCURRENCY env var), still clamped to MAX_CONCURRENCY.
  assert.match(route, /portalConfig\.Bulk_Resume_Upload_Concurrency/);
  assert.match(route, /DEFAULT_CONCURRENCY = 2/);
  assert.match(route, /MAX_CONCURRENCY = 2/);
  // The old implementation awaited each n8n round trip inside a plain
  // `for...of` loop, which is exactly what capped bulk screening at
  // roughly one resume per minute. That pattern must not come back.
  assert.doesNotMatch(route, /for \(const file of files\)/);
  assert.match(route, /Array\.from\(\{ length: concurrency \}, worker\)/);
  assert.match(route, /WORKER_START_INTERVAL_MS = 10_000/);
  assert.match(route, /waitForWorkerStart/);
});

test("bulk Sheets reads use a quota-sized exponential backoff window", () => {
  const cache = read("src/lib/sheets-cache.ts");
  const queue = read("src/lib/candidate-applications.ts");
  const intake = read("integrations/n8n/bulk-resume-upload-intake.ts");
  assert.match(cache, /attempts = 5/);
  assert.match(cache, /Math\.min\(30_000, 2_000 \* 2 \*\* attempt\)/);
  assert.match(queue, /withSheetsBackoff/);
  assert.match(intake, /retryOnFail: true, maxTries: 5, waitBetweenTries: 5000/);
});

test("every bulk file gets a saved queue event before downstream parsing", () => {
  const route = read("src/lib/bulk-resume-intake.ts");
  const queue = read("src/lib/candidate-applications.ts");
  assert.match(route, /appendBulkResumeQueueEvent/);
  assert.match(route, /status: "Processing"/);
  assert.match(route, /status: "Failed"/);
  assert.match(queue, /getBulkResumeQueueTotals/);
  assert.match(queue, /including retries/);
});

test("application invitations can send email and lock the invited identity", () => {
  const inviteRoute = read("src/app/api/roles/[roleId]/resume-screening/invite/route.ts");
  const emailSender = read("src/lib/application-invite-email.ts");
  const candidatePage = read("public/index.html");
  assert.match(inviteRoute, /sendEmail/);
  assert.match(inviteRoute, /sendApplicationInviteEmail/);
  assert.match(emailSender, /getPortalConfigValue\("N8N_Application_Invite_Email_Webhook_URL"\)/);
  assert.match(emailSender, /N8N_APPLICATION_INVITE_EMAIL_TARGET_WEBHOOK_URL/);
  assert.match(emailSender, /N8N_Application_Invite_Email_Target_Webhook_URL/);
  assert.match(emailSender, /application_invite_email_requested/);
  assert.match(candidatePage, /candidateNameField\.readOnly = true/);
  assert.match(candidatePage, /candidateEmailField\.readOnly = true/);
});

test("same-batch duplicate files are reserved by content hash before any Drive/n8n work starts", () => {
  const route = read("src/lib/bulk-resume-intake.ts");
  assert.match(route, /claimedInBatch/);
  assert.match(route, /Duplicate file selected in this same upload\./);
});

test("re-uploading a historical hash reuses the existing Drive object", () => {
  const files = read("src/lib/resume-files.ts");
  assert.match(files, /properties has \{ key='sha256' and value='/);
  assert.match(files, /existingRecord/);
  assert.match(files, /reused: true/);
  const upload = read("src/lib/bulk-resume-intake.ts");
  assert.match(upload, /if \(!stored\.reused\) await deleteResumeFile/);
});

test("bulk completion emails default to disabled but remain configurable", () => {
  const route = read("src/lib/bulk-resume-intake.ts");
  assert.match(route, /BULK_RESUME_NOTIFY_ON_SUCCESS/);
  assert.match(route, /notifyOnSuccess \? "not_requested" : "disabled"/);
  assert.match(route, /notificationResponse\.ok \? "sent" : "failed"/);
  assert.match(route, /notificationStatus = "failed"/);
  assert.match(route, /allResultsTerminal/);
});

test("an accepted asynchronous intake request cannot be presented as completed", () => {
  const route = read("src/lib/bulk-resume-intake.ts");
  assert.match(route, /reportedStatus/);
  assert.match(route, /reportedStatus\) \? reportedStatus : "Queued"/);
  assert.doesNotMatch(route, /String\(workflowResult\.status \|\| "Screened"\)/);
});

test("each per-file screening webhook is time-bounded so one stuck n8n call cannot hang the batch", () => {
  const route = read("src/lib/bulk-resume-intake.ts");
  assert.match(route, /N8N_BULK_RESUME_TIMEOUT_MS/);
  assert.match(route, /const abort = new AbortController\(\)/);
  assert.match(route, /signal: abort\.signal/);
  assert.match(route, /did not respond within \$\{Math\.round\(timeoutMs \/ 1000\)\}s/);
  // default 60s, same as the single-application path
  assert.match(route, /: 60_000;/);
});

test("a resume the workflow rejects synchronously is not billed", () => {
  const route = read("src/lib/bulk-resume-intake.ts");
  // The workflow status is read BEFORE the deduction, and failed/skipped
  // synchronous outcomes skip recordDeduction entirely.
  const statusIdx = route.indexOf("const reportedStatus");
  const deductionIdx = route.indexOf("recordDeduction({");
  assert.ok(statusIdx > 0 && deductionIdx > statusIdx, "workflow status must be parsed before the deduction");
  assert.match(route, /rejectedSynchronously = \/\^\(failed\|skipped\)\$\/i\.test\(terminalStatus\)/);
  assert.match(route, /if \(!rejectedSynchronously\) \{\s*creditedFiles \+= 1;/);
  // the deduction call sits inside that guard
  const guardBlock = route.slice(route.indexOf("if (!rejectedSynchronously)"), route.indexOf("if (!rejectedSynchronously)") + 600);
  assert.match(guardBlock, /recordDeduction\(\{/);
  assert.match(guardBlock, /event: "cv_analysis"/);
});

test("the intake contract records Screened only after the candidate workflow accepts", () => {
  const intake = read("integrations/n8n/bulk-resume-upload-intake.ts");
  assert.match(intake, /responseMode: 'responseNode'/);
  assert.match(intake, /accepted \? 'Screened' : 'Failed'/);
  assert.match(intake, /saveScreened/);
});

test("the intake handoff uses the verified Production Foundation webhook and preserves UAT metadata", () => {
  const intake = read("integrations/n8n/bulk-resume-upload-intake.ts");
  assert.match(intake, /candidate-application/);
  assert.doesNotMatch(intake, /__CANDIDATE_WEBHOOK_URL__/);
  assert.match(intake, /environment: \$json\.environment/);
  assert.match(intake, /is_uat: \$json\.is_uat/);
  assert.match(intake, /batchId: \$json\.batchId/);
  assert.match(intake, /jobId: \$json\.jobId/);
  assert.match(intake, /fullResponse: true/);
  assert.match(intake, /neverError: true/);
});

test("portal intake appends terminal queue events without per-item Sheets reads", () => {
  const intake = read("integrations/n8n/bulk-resume-upload-intake.ts");
  assert.doesNotMatch(intake, /Read Bulk Resume Queue/);
  assert.doesNotMatch(intake, /Record Resume Processing/);
  assert.match(intake, /const environment = text\(body\.environment\)/);
  assert.match(intake, /operation: 'append'/);
  assert.doesNotMatch(intake, /matchingColumns: \['jobId'\]/);
  assert.match(intake, /schema: queueSchema/);
  assert.match(intake, /Candidate Foundation handoff failed before a response was received/);
});

test("Google Drive folder screening uses the same stable queue contract for every role", () => {
  const drive = read("integrations/n8n/jd-role-folder-bulk-resume-screening.ts");
  const submit = drive.slice(drive.indexOf("const submit = node"), drive.indexOf("const evaluate"));
  assert.match(drive, /operation: 'appendOrUpdate'/);
  assert.match(drive, /matchingColumns: \['jobId'\]/);
  assert.match(drive, /jobId: 'DRIVE-' \+ roleId \+ '-' \+ id/);
  assert.match(drive, /environment: 'production'/);
  assert.match(drive, /is_uat: false/);
  assert.doesNotMatch(submit, /__WEBHOOK_SECRET__/);
  assert.match(drive, /candidate-application/);
  assert.match(drive, /Candidate Foundation handoff failed before a response was received/);
});

test("live bulk status reads are fresh and expose the downstream queue as the source of truth", () => {
  const queue = read("src/lib/candidate-applications.ts");
  const cache = read("src/lib/sheets-cache.ts");
  const route = read("src/app/api/resume-screening/bulk/route.ts");
  assert.match(queue, /getBulkResumeQueue\(roleId = "", options: \{ fresh\?: boolean \} = \{\}\)/);
  assert.match(queue, /freshSheetsRead/);
  assert.match(queue, /getBulkResumeScreeningEvidence/);
  assert.match(queue, /Bulk_Resume_Queue", "U"/);
  assert.match(cache, /export async function freshSheetsRead/);
  assert.match(route, /saved applicant screening result/);
  assert.match(route, /getBulkResumeQueue\(roleId, \{ fresh: true \}\)/);
  assert.match(route, /productionUatActive/);
  assert.match(route, /configuredProductionUatBatchId/);
});

test("bulk status reconciliation supports historical identifiers and expires stale terminal waits", () => {
  const queue = read("src/lib/candidate-applications.ts");
  const route = read("src/app/api/resume-screening/bulk/route.ts");
  assert.match(queue, /byJobId/);
  assert.match(queue, /byApplicationId/);
  assert.match(queue, /byResumeSha/);
  assert.match(queue, /byDriveFileId/);
  assert.match(queue, /byRoleAndFileName/);
  assert.match(route, /STALE_PROCESSING_MS = 30 \* 60 \* 1000/);
  assert.match(route, /Applicant result could not be persisted/);
  assert.match(route, /Screening did not produce a saved result within 30 minutes/);
});

test("bulk retries stale queue states only when no saved applicant evidence exists", () => {
  const upload = read("src/lib/bulk-resume-intake.ts");
  const route = read("src/app/api/resume-screening/bulk/upload/route.ts");
  assert.match(upload, /immediateUatRecovery = isUat/);
  assert.match(route, /uatRecovery/); // the route still reads it from the form
  assert.match(upload, /recoveryMayBypassTerminalState = immediateUatRecovery/);
  assert.match(upload, /const savedScreeningEvidence = await getBulkResumeScreeningEvidence\(queue\)/);
  assert.match(upload, /const shouldSkip = previousIsActive && !recoveryMayBypassTerminalState && \(previousHasSavedResult \|\| previousRunIsFresh\)/);
  assert.match(upload, /const STALE_PROCESSING_MS = 30 \* 60 \* 1000/);
});

test("uploaded resumes keep a traceable Drive link back to the candidate/application", () => {
  const route = read("src/lib/bulk-resume-intake.ts");
  assert.match(route, /function driveFileUrl/);
  assert.match(route, /drive\.google\.com\/file\/d\//);
});

test("the bulk panel supports drag-and-drop, live auto-refresh, and retrying only failed files", () => {
  const panel = read("src/components/BulkResumeScreeningPanel.tsx");
  assert.match(panel, /onDrop=/);
  assert.match(panel, /setInterval\(\(\) => \{ void refreshStatus\(\); \}, POLL_INTERVAL_MS\)/);
  assert.match(panel, /Retry failed/);
  assert.match(panel, /failedFiles/);
  assert.match(panel, /Bulk Resume Processing/);
  assert.match(panel, /Bulk screening completed/);
  assert.match(panel, /View Processed Applicants/);
  assert.match(panel, /Retry \{failedFiles\.length\} Failed/);
  assert.match(panel, /refreshInFlight/);
  assert.match(panel, /AbortController/);
  assert.match(panel, /successful completion must come from the queue-backed status API/);
  assert.match(panel, /const POLL_INTERVAL_MS = 60000/);
  assert.match(panel, /updates automatically every minute/);
});

test("the bulk panel shows auto-dismissing feedback and portal-timezone timestamps", () => {
  const panel = read("src/components/BulkResumeScreeningPanel.tsx");
  // success / warning / error notices go through the shared auto-dismiss component
  assert.match(panel, /import ActionFeedback from "@\/components\/ActionFeedback"/);
  assert.match(panel, /<ActionFeedback kind="success"[^>]*>\{uploadMessage\}<\/ActionFeedback>/);
  assert.match(panel, /<ActionFeedback kind="warning"[^>]*>\{warning\}<\/ActionFeedback>/);
  assert.match(panel, /<ActionFeedback kind="error"[^>]*>\{error\}<\/ActionFeedback>/);
  assert.doesNotMatch(panel, /<div className="success-box">\{uploadMessage\}<\/div>/);
  // the over-cap notice is a transient warning, not a sticky error
  assert.match(panel, /setWarning\(`You can screen up to \$\{MAX_FILES_PER_SUBMISSION\}/);
  // the queue table renders Asia/Singapore local time, never a raw UTC ISO string
  assert.match(panel, /import \{ formatPortalDateTime \} from "@\/lib\/portal-time"/);
  assert.match(panel, /formatPortalDateTime\(ts\)/);
  assert.doesNotMatch(panel, /<td>\{item\.lastUpdated \|\| item\.processedAt \|\| item\.discoveredAt \|\| "—"\}<\/td>/);
});

test("ActionFeedback auto-dismisses success and warning but keeps errors", () => {
  const fb = read("src/components/ActionFeedback.tsx");
  assert.match(fb, /success: 5000/);
  assert.match(fb, /warning: 7000/);
  assert.match(fb, /error: null/);
  assert.match(fb, /setTimeout\(\(\) => setVisible\(false\), timeout\)/);
});

test("bulk upload is wired into the live Resume Screening page", () => {
  const screening = read("src/app/resume-screening/page.tsx");
  assert.match(screening, /BulkResumeScreeningPanel/);
});

test("invite links can use a separate candidate page origin without breaking portal API CORS", () => {
  const inviteRoute = read("src/app/api/roles/[roleId]/resume-screening/invite/route.ts");
  const inviteStore = read("src/lib/resume-screening-invite.ts");
  const applications = read("src/app/api/public/applications/route.ts");
  const inviteLookup = read("src/app/api/public/resume-screening-invite/[token]/route.ts");
  const candidatePage = read("public/index.html");
  const publicCors = read("src/lib/public-cors.ts");
  const envExample = read(".env.example");
  const homePage = read("src/app/page.tsx");
  const proxy = read("proxy.ts");
  assert.match(inviteRoute, /portalConfig\.Resume_Screening_Invite_Base_URL/);
  assert.match(inviteRoute, /portalConfig\.N8N_Bulk_Resume_Portal_Base_URL/);
  assert.match(publicCors, /RESUME_SCREENING_INVITE_BASE_URL/);
  assert.match(envExample, /RESUME_SCREENING_INVITE_BASE_URL=https:\/\/your-portal-domain\/index\.html/);
  assert.match(inviteStore, /applicationInviteLink/);
  assert.match(inviteStore, /url\.pathname = "\/index\.html"/);
  assert.match(inviteStore, /url\.searchParams\.set\("invite", token\)/);
  assert.match(candidatePage, /const inviteToken =/);
  assert.match(candidatePage, /api\/public\/resume-screening-invite/);
  assert.match(candidatePage, /api\/public\/applications/);
  assert.match(candidatePage, /const PORTAL_API_BASE_URL = "https:\/\/ella-recruitment\.mclinkgroup\.com"/);
  assert.match(publicCors, /new URL\(cleanValue\)\.origin/);
  assert.match(applications, /intake\.body\.candidateName = invitation\.candidateName/);
  assert.match(applications, /intake\.body\.candidateEmail = invitation\.candidateEmail/);
  assert.match(applications, /reason: invitation\?\.reason/);
  assert.match(applications, /status: "Pending HR Review"/);
  assert.match(inviteLookup, /applicationId: invitation\.applicationId/);
  assert.match(inviteLookup, /applicationStatus: applicationStatus/);
  assert.match(candidatePage, /function showUsedInviteStatus\(data\)/);
  assert.match(candidatePage, /Pending HR Review/);
  assert.match(candidatePage, /data\.applicationStatus/);
  assert.match(candidatePage, /data\.reason === "used"/);
  assert.match(homePage, /candidatePageUrl\.searchParams\.set\("invite", inviteValue\)/);
  assert.match(proxy, /pathname === "\/index\.html"/);
  assert.match(proxy, /searchParams\.get\("invite"\)/);
  assert.match(candidatePage, /showInviteLinkError\("required"\)/);
  assert.doesNotMatch(candidatePage, /recruitmentEndpoint\("\/recruitment\/apply"\)/);
  assert.match(applications, /code: "INVITE_REQUIRED"/);
});

test("bulk UAT mode is fail-closed and carries environment correlation metadata", () => {
  const config = read("src/lib/bulk-resume-config.ts");
  const files = read("src/lib/resume-files.ts");
  const upload = read("src/lib/bulk-resume-intake.ts");
  const queue = read("src/lib/candidate-applications.ts");
  const page = read("src/app/resume-screening/page.tsx");
  assert.match(config, /BULK_RESUME_UAT_DRIVE_FOLDER_ID/);
  assert.match(config, /BULK_RESUME_UAT_SPREADSHEET_ID/);
  assert.match(config, /N8N_BULK_RESUME_UPLOAD_UAT_WEBHOOK_URL/);
  assert.match(config, /N8N_BULK_RESUME_UAT_WEBHOOK_SECRET/);
  assert.match(config, /BULK_RESUME_PRODUCTION_UAT_BATCH_ID/);
  assert.match(config, /Do not fall back to Production IDs/);
  assert.match(files, /storeResumeFile\(file: File, options/);
  assert.match(files, /environment === "uat"/);
  assert.match(upload, /environment/);
  assert.match(upload, /is_uat/);
  assert.match(upload, /jobId/);
  assert.match(upload, /bulkResumeIsUatMarked/);
  assert.match(upload, /!isUat/);
  assert.match(queue, /bulkResumeSpreadsheetId\(\)/);
  assert.match(page, /UAT MODE/);
});
