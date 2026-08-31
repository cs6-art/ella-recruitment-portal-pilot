import crypto from "node:crypto";

import { appendBulkResumeQueueEvent, getBulkResumeQueue, getBulkResumeScreeningEvidence, type BulkResumeQueueItem } from "@/lib/candidate-applications";
import { assertCreditsAvailable, creditCostFor, EllaCreditsError, recordDeduction } from "@/lib/ella-credits";
import { getPortalConfig, isEnabledChoice } from "@/lib/portal-config";
import { extractResumeContactDetails } from "@/lib/resume-contact-extraction";
import { bulkResumeEnvironment, bulkResumeIsUatMarked, bulkResumeWebhookConfig, productionUatBatchId } from "@/lib/bulk-resume-config";
import { deleteResumeFile, MAX_RESUME_FILE_BYTES, storeResumeFile } from "@/lib/resume-files";

/**
 * Shared bulk-resume intake pipeline. Both the local multi-file upload
 * (`/api/resume-screening/bulk/upload`) and the Google Drive import
 * (`/api/resume-screening/drive/import`) feed the exact same path: SHA-256
 * dedupe, `storeResumeFile` to the Shared Drive, a `Bulk_Resume_Queue`
 * `Processing` row, the `bulk_resume_uploaded` n8n webhook, one `cv_analysis`
 * credit per accepted file, and the optional batch-complete notification.
 *
 * Behaviour is a verbatim relocation of what previously lived in the upload
 * route — nothing about dedupe, the queue schema, the webhook payload/headers,
 * credit deduction, concurrency, or the notification changed; only the home.
 */

// Internal architecture limit — the worker pool, dedupe, and per-batch
// bookkeeping are all built and tested for this many files. Do not lower it;
// raising the operator-facing cap later is a one-line change to the constant
// below.
export const MAX_FILES_PER_BATCH = 25;

// Temporary operator-facing hard cap on files per submission, enforced at both
// the UI and server validation layers for the local upload and the Google
// Drive import. It exists only because the intake pipeline currently runs the
// staggered worker pool inline in the request (~(N-2)x10s), so a larger batch
// risks a client-visible function timeout on the default platform budget.
// Raise this back toward MAX_FILES_PER_BATCH once dispatch moves off-request.
// See docs/BATCH-CAPACITY-VALIDATION.md.
export const MAX_FILES_PER_SUBMISSION = 8;

export const MAX_BULK_REQUEST_BYTES = 100 * 1024 * 1024;
const STALE_PROCESSING_MS = 30 * 60 * 1000;

const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 2;
const WORKER_START_INTERVAL_MS = 10_000;

function resolveConcurrency(fileCount: number, configuredValue: string) {
  const configured = Number(configuredValue);
  const bounded = Number.isFinite(configured) && configuredValue.trim() !== "" ? Math.min(Math.max(Math.trunc(configured), 1), MAX_CONCURRENCY) : DEFAULT_CONCURRENCY;
  return Math.max(1, Math.min(bounded, fileCount));
}

function queueIdForHash(roleId: string, sha256: string) {
  const roleKey = roleId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "-");
  return `BULK-${roleKey}-${sha256}`;
}

function legacyQueueIdForHash(sha256: string) {
  return `BULK-${sha256}`;
}

function driveFileUrl(fileId: string) {
  return fileId ? `https://drive.google.com/file/d/${fileId}/view` : "";
}

export type IntakeSource = {
  name: string;
  mimeType: string;
  getBytes: () => Promise<Buffer>;
  /** The originating Drive file id, for the Drive import path (traceability only). */
  driveFileId?: string;
};

export type IntakeResult = {
  results: Array<Record<string, unknown>>;
  batchId: string;
  environment: string;
  isUat: boolean;
  notificationStatus: "sent" | "failed" | "disabled" | "not_requested";
  concurrency: number;
  submitted: number;
  creditsCharged: number;
};

export async function intakeResumeBatch(input: {
  roleId: string;
  roleTitle: string;
  actorName: string;
  actorEmail: string;
  submittedByEmail: string;
  sources: IntakeSource[];
  /** e.g. "Portal Bulk Upload" or "Portal Drive Import". */
  sourceLabel: string;
  /** The Production-UAT recovery batch id, when the operator supplied it. */
  uatRecoveryToken?: string;
}): Promise<IntakeResult> {
  const { roleId, actorName, actorEmail } = input;
  const environment = bulkResumeEnvironment();
  const isUat = bulkResumeIsUatMarked();
  const configuredUatBatchId = productionUatBatchId();
  const immediateUatRecovery = isUat && Boolean(configuredUatBatchId) && (input.uatRecoveryToken || "").trim() === configuredUatBatchId;

  const portalConfig = await getPortalConfig();
  const { url: webhookUrl, secret: webhookSecret } = await bulkResumeWebhookConfig();

  const queue = await getBulkResumeQueue(roleId, { fresh: true });
  const latestByFile = new Map(queue.map((item) => [item.driveFileId, item]));
  const savedScreeningEvidence = await getBulkResumeScreeningEvidence(queue);
  const results: Array<Record<string, unknown>> = [];
  let creditedFiles = 0;
  const batchId = configuredUatBatchId || `${isUat ? "UAT-BATCH" : "BATCH"}-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  const claimedInBatch = new Set<string>();
  const hashed = await Promise.all(input.sources.map(async (source) => {
    const bytes = await source.getBytes();
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    return { source, bytes, sha256, queueId: queueIdForHash(roleId, sha256) };
  }));
  const toProcess: typeof hashed = [];
  for (const item of hashed) {
    if (claimedInBatch.has(item.queueId)) {
      results.push({ fileName: item.source.name, queueId: item.queueId, status: "Skipped", skipped: true, message: "Duplicate file selected in this same upload." });
      continue;
    }
    claimedInBatch.add(item.queueId);
    toProcess.push(item);
  }

  // Each resume that reaches the screening workflow costs 1 Ella Credit.
  // Pre-check the whole batch so an under-funded intake is refused before any
  // file is sent downstream. Callers map EllaCreditsError to a 402.
  if (toProcess.length > 0) {
    await assertCreditsAvailable(toProcess.length, "cv_analysis");
  }

  async function processItem(item: (typeof hashed)[number]) {
    const { source, bytes, queueId } = item;
    let stored: Awaited<ReturnType<typeof storeResumeFile>> | null = null;
    let resolvedQueueId = queueId;
    const submittedAt = new Date().toISOString();
    try {
      if (bytes.length > MAX_RESUME_FILE_BYTES) throw new Error("Resume files must be 10 MB or smaller.");
      const file = new File([new Uint8Array(bytes)], source.name || "resume", { type: source.mimeType || "application/octet-stream" });
      stored = await storeResumeFile(file, { environment });
      resolvedQueueId = queueIdForHash(roleId, stored.record.sha256);
      const previous = latestByFile.get(resolvedQueueId) || latestByFile.get(legacyQueueIdForHash(stored.record.sha256));
      const previousStatus = previous?.status.toLowerCase() || "";
      const evidenceKey = `${roleId.toLowerCase()}|${resolvedQueueId.toLowerCase()}`;
      const previousHasSavedResult = savedScreeningEvidence.has(evidenceKey);
      const previousUpdatedAt = Date.parse(previous?.lastUpdated || previous?.processingStartedAt || previous?.discoveredAt || "");
      const previousRunIsFresh = Number.isFinite(previousUpdatedAt) && Date.now() - previousUpdatedAt < STALE_PROCESSING_MS;
      const previousIsActive = previousStatus === "queued" || previousStatus === "screened" || previousStatus === "processing";
      const recoveryMayBypassTerminalState = immediateUatRecovery && !previousHasSavedResult && previousStatus === "screened";
      const shouldSkip = previousIsActive && !recoveryMayBypassTerminalState && (previousHasSavedResult || previousRunIsFresh);
      if (shouldSkip) {
        if (!stored.reused) await deleteResumeFile(stored.record);
        results.push({ fileName: source.name, queueId: resolvedQueueId, status: previousHasSavedResult ? "Screened" : previous?.status || "Queued", skipped: true, message: previousHasSavedResult || previousStatus === "screened" ? "This resume was already screened for this role." : previousStatus === "queued" ? "This resume is already queued for this role." : "This resume is already being screened for this role." });
        return;
      }

      const fileUrl = driveFileUrl(stored.record.fileId);
      const extractedContact = extractResumeContactDetails(stored.extractedText);
      const applicationId = `${isUat ? "UAT-" : ""}APP-${crypto.createHash("sha256").update(`${roleId}:${stored.record.sha256}`).digest("hex").slice(0, 24)}`;
      const attemptCount = String(Number(previous?.attemptCount || 0) + 1);
      await appendBulkResumeQueueEvent({
        driveFileId: resolvedQueueId,
        driveFileName: stored.record.fileName,
        driveFileUrl: fileUrl,
        driveFileMimeType: stored.record.mimeType,
        roleId,
        candidateName: extractedContact.candidateName,
        candidateEmail: extractedContact.candidateEmail,
        status: "Processing",
        applicationId,
        discoveredAt: submittedAt,
        processingStartedAt: submittedAt,
        attemptCount,
        lastUpdated: submittedAt,
        environment: isUat ? "uat" : environment,
        isUat,
        batchId,
        jobId: resolvedQueueId,
      });
      const payload = {
        eventType: "bulk_resume_uploaded",
        batchId,
        queueId: resolvedQueueId,
        roleId,
        applicationId,
        fileName: stored.record.fileName,
        mimeType: stored.record.mimeType,
        sha256: stored.record.sha256,
        resumeText: stored.extractedText,
        candidateName: extractedContact.candidateName,
        candidateEmail: extractedContact.candidateEmail,
        preferredMobile: extractedContact.preferredMobile,
        applicantCountry: extractedContact.applicantCountry,
        resumeFile: stored.record,
        driveFileUrl: fileUrl,
        submittedAt,
        source: `${input.sourceLabel}${isUat ? " (UAT)" : ""}`,
        environment: isUat ? "uat" : environment,
        isUat,
        is_uat: isUat,
        attemptCount,
        jobId: resolvedQueueId,
      };
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Webhook-Secret": webhookSecret, "X-Idempotency-Key": resolvedQueueId },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`The screening workflow returned HTTP ${response.status}.`);
      // The active intake webhook uses an immediate acknowledgement, so a 2xx
      // only means n8n accepted the request — not that extraction, AI
      // screening, and applicant persistence have finished. The queue poll
      // stays the source of truth for terminal status.
      creditedFiles += 1;
      await recordDeduction({
        event: "cv_analysis",
        units: 1,
        reference: resolvedQueueId,
        roleId,
        actorName,
        actorEmail,
        note: "Bulk resume screening",
      }).catch((creditError) => console.error("[Bulk Resume Intake] Could not record credit deduction:", creditError));
      const workflowResult = await response.json().catch(() => ({})) as Record<string, unknown>;
      const reportedStatus = String(workflowResult.status || "").trim();
      const terminalStatus = /^(screened|processed|failed|skipped)$/i.test(reportedStatus) ? reportedStatus : "Queued";

      const queueItem: BulkResumeQueueItem = {
        driveFileId: resolvedQueueId,
        driveFileName: stored.record.fileName,
        driveFileUrl: fileUrl,
        roleId,
        candidateName: "",
        candidateEmail: "",
        status: terminalStatus,
        applicationId,
        errorMessage: "",
        discoveredAt: submittedAt,
        processingStartedAt: submittedAt,
        processedAt: /^(screened|processed)$/i.test(terminalStatus) ? submittedAt : "",
        attemptCount,
        lastUpdated: submittedAt,
      };
      latestByFile.set(resolvedQueueId, queueItem);
      results.push({ fileName: stored.record.fileName, queueId: resolvedQueueId, applicationId, status: terminalStatus, driveFileUrl: fileUrl });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unable to submit this resume.";
      await appendBulkResumeQueueEvent({
        driveFileId: resolvedQueueId,
        driveFileName: stored?.record.fileName || source.name,
        driveFileUrl: stored ? driveFileUrl(stored.record.fileId) : "",
        driveFileMimeType: stored?.record.mimeType || source.mimeType,
        roleId,
        status: "Failed",
        applicationId: stored ? `${isUat ? "UAT-" : ""}APP-${crypto.createHash("sha256").update(`${roleId}:${stored.record.sha256}`).digest("hex").slice(0, 24)}` : "",
        errorMessage,
        discoveredAt: submittedAt,
        processingStartedAt: submittedAt,
        processedAt: submittedAt,
        attemptCount: "1",
        lastUpdated: new Date().toISOString(),
        environment: isUat ? "uat" : environment,
        isUat,
        batchId,
        jobId: resolvedQueueId,
      }).catch((queueError) => console.error("[Bulk Resume Intake] Could not save failure queue event:", queueError));
      if (stored && !results.some((result) => result.queueId === queueIdForHash(roleId, stored?.record.sha256 || ""))) await deleteResumeFile(stored.record).catch(() => undefined);
      results.push({ fileName: source.name, queueId: resolvedQueueId, status: "Failed", error: errorMessage });
    }
  }

  const concurrency = resolveConcurrency(toProcess.length, portalConfig.Bulk_Resume_Upload_Concurrency);
  let cursor = 0;
  let startedWorkers = 0;
  let nextWorkerStartAt = 0;
  async function waitForWorkerStart() {
    const workerNumber = startedWorkers++;
    if (workerNumber < concurrency) {
      if (workerNumber === concurrency - 1) nextWorkerStartAt = Date.now() + WORKER_START_INTERVAL_MS;
      return;
    }
    const startAt = Math.max(Date.now(), nextWorkerStartAt);
    nextWorkerStartAt = startAt + WORKER_START_INTERVAL_MS;
    const delay = startAt - Date.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  async function worker() {
    while (cursor < toProcess.length) {
      const index = cursor++;
      await waitForWorkerStart();
      await processItem(toProcess[index]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  // Batch-complete emails are off by default (Settings `Bulk_Resume_Notify_On_Success`,
  // env `BULK_RESUME_NOTIFY_ON_SUCCESS`) and only fire when every file reached
  // a terminal status — never for a plain asynchronous acknowledgement.
  const notifyOnSuccess = isEnabledChoice(portalConfig.Bulk_Resume_Notify_On_Success);
  let notificationStatus: IntakeResult["notificationStatus"] = notifyOnSuccess ? "not_requested" : "disabled";
  const notificationUrl = portalConfig.N8N_Role_Webhook_URL.trim();
  const terminalResults = new Set(["screened", "processed", "failed", "skipped"]);
  const allResultsTerminal = results.length > 0 && results.every((result) => terminalResults.has(String(result.status || "").toLowerCase()));
  if (notifyOnSuccess && !isUat && allResultsTerminal && notificationUrl && webhookSecret && input.sources.length > 0) {
    try {
      const notificationResponse = await fetch(notificationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Webhook-Secret": webhookSecret, "X-Idempotency-Key": `bulk-batch-${batchId}` },
        body: JSON.stringify({
          eventType: "bulk_resume_batch_complete",
          batchId,
          roleId,
          roleTitle: input.roleTitle || "",
          submittedByEmail: input.submittedByEmail,
          totalFiles: input.sources.length,
          submitted: results.filter((result) => ["Screened", "Processed"].includes(String(result.status))).length,
          skipped: results.filter((result) => result.skipped === true).length,
          failed: results.filter((result) => result.status === "Failed").length,
          results,
          completedAt: new Date().toISOString(),
          source: input.sourceLabel,
        }),
        cache: "no-store",
      });
      notificationStatus = notificationResponse.ok ? "sent" : "failed";
    } catch (error) {
      console.error("[Bulk Resume Intake] completion notification failed:", error);
      notificationStatus = "failed";
    }
  }

  const submitted = results.filter((result) => !result.skipped && String(result.status || "").toLowerCase() !== "failed").length;
  const creditsCharged = creditedFiles * (await creditCostFor("cv_analysis"));

  return {
    results,
    batchId,
    environment: isUat ? "uat" : environment,
    isUat,
    notificationStatus,
    concurrency,
    submitted,
    creditsCharged,
  };
}

export { EllaCreditsError };
