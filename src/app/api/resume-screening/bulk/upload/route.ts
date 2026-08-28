import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canManagePipeline } from "@/lib/access-control";
import { appendBulkResumeQueueEvent, getBulkResumeQueue, getBulkResumeScreeningEvidence, type BulkResumeQueueItem } from "@/lib/candidate-applications";
import { assertCreditsAvailable, creditCostFor, EllaCreditsError, recordDeduction } from "@/lib/ella-credits";
import { getPortalConfig, isEnabledChoice } from "@/lib/portal-config";
import { extractResumeContactDetails } from "@/lib/resume-contact-extraction";
import { getRoleRequestById, isPublishedRoleForIntake } from "@/lib/google-sheets";
import { bulkResumeEnvironment, bulkResumeIsUatMarked, bulkResumeWebhookConfig, productionUatBatchId } from "@/lib/bulk-resume-config";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { deleteResumeFile, MAX_RESUME_FILE_BYTES, storeResumeFile } from "@/lib/resume-files";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES_PER_BATCH = 25;
const MAX_BULK_REQUEST_BYTES = 100 * 1024 * 1024;
const STALE_PROCESSING_MS = 30 * 60 * 1000;

// Each file's pipeline (contact extraction + role-specific AI screening,
// chained across two n8n workflows) previously ran one at a time from this
// route, which is why bulk screening topped out around 1 resume/minute even
// though nothing else in the chain was that slow. Files are independent of
// each other (distinct content hash, distinct queue row), so running several
// in flight at once is safe; the concurrency is capped and configurable so
// it can be tuned to the connected OpenAI/Google Sheets quota instead of
// guessed. The production cap is intentionally conservative because each file
// triggers several downstream Google Sheets reads/writes.
// Keep the burst below the service account's per-user quota while retaining
// limited parallelism for throughput.
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 2;
const WORKER_START_INTERVAL_MS = 10_000;
function resolveConcurrency(fileCount: number, configuredValue: string) {
  const configured = Number(configuredValue);
  const bounded = Number.isFinite(configured) && configuredValue.trim() !== "" ? Math.min(Math.max(Math.trunc(configured), 1), MAX_CONCURRENCY) : DEFAULT_CONCURRENCY;
  return Math.max(1, Math.min(bounded, fileCount));
}

function responseError(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
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

export async function POST(request: Request) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return responseError("Authentication required.", 401);
  if (!canManagePipeline(user)) return responseError("Only HR reviewers can upload bulk resumes.", 403);
  const actorName = user.name;
  const actorEmail = user.email;

  const rate = consumeRateLimit(`bulk-resume-upload:${user.email}:${requestClientKey(request)}`, 5, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many bulk uploads. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BULK_REQUEST_BYTES) return responseError("Bulk uploads must be 100 MB or smaller per batch.", 413);

  const environment = bulkResumeEnvironment();
  const isUat = bulkResumeIsUatMarked();
  const configuredUatBatchId = productionUatBatchId();

  try {
    const portalConfig = await getPortalConfig();
    const { url: webhookUrl, secret: webhookSecret } = await bulkResumeWebhookConfig();
    const formData = await request.formData();
    const roleId = String(formData.get("roleId") || "").trim();
    const files = formData.getAll("resumes").filter((value): value is File => value instanceof File);
    // This is an operator-controlled escape hatch for the marked Production
    // UAT batch only. It is intentionally not a general stale-timeout change:
    // the operator may set it only after checking n8n execution history and
    // confirming that the listed terminal/orphaned attempts are dead.
    const immediateUatRecovery = isUat && Boolean(configuredUatBatchId) && String(formData.get("uatRecovery") || "").trim() === configuredUatBatchId;
    if (!roleId) return responseError("Select a published role before uploading resumes.", 422);
    // Keep the API contract explicit: legacy binary DOC is accepted alongside
    // the PDF/DOCX formats supported by the shared extractor.
    if (!files.length) return responseError("Choose at least one PDF, DOC, or DOCX resume.", 422);
    if (files.length > MAX_FILES_PER_BATCH) return responseError(`Upload up to ${MAX_FILES_PER_BATCH} resumes per batch.`, 422);

    const role = await getRoleRequestById(roleId);
    if (!role || !isPublishedRoleForIntake(role)) return responseError("The selected role is not available for bulk screening.", 409);

    // This is the duplicate gate for the portal endpoint. Bypass the short
    // process-local Sheets cache so a successful prior upload is not missed
    // by a retry from another serverless instance.
    const queue = await getBulkResumeQueue(roleId, { fresh: true });
    const latestByFile = new Map(queue.map((item) => [item.driveFileId, item]));
    const savedScreeningEvidence = await getBulkResumeScreeningEvidence(queue);
    const results: Array<Record<string, unknown>> = [];
    // Files whose screening request was accepted downstream (and therefore
    // charged an Ella Credit). Surfaced so the client meter can tick down live.
    let creditedFiles = 0;
    // Keep one correlation id for the complete upload so the internal
    // notification contains a single, auditable batch summary.
    const batchId = configuredUatBatchId || `${isUat ? "UAT-BATCH" : "BATCH"}-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    // Concurrent workers below can race on the exact same file content
    // appearing twice in one batch (e.g. a candidate's resume picked up
    // from two folders): both could pass the "not already queued" check
    // before either has written a status. Reserve each content hash
    // synchronously, up front, so a same-batch duplicate is caught here
    // instead of being screened twice.
    const claimedInBatch = new Set<string>();
    async function hashFile(file: File) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      return { file, sha256, queueId: queueIdForHash(roleId, sha256) };
    }
    const hashed = await Promise.all(files.map(hashFile));
    const toProcess: typeof hashed = [];
    for (const item of hashed) {
      if (claimedInBatch.has(item.queueId)) {
        results.push({ fileName: item.file.name, queueId: item.queueId, status: "Skipped", skipped: true, message: "Duplicate file selected in this same upload." });
        continue;
      }
      claimedInBatch.add(item.queueId);
      toProcess.push(item);
    }

    // Each resume that reaches the screening workflow costs 1 Ella Credit.
    // Pre-check the whole batch so an under-funded upload is refused before any
    // file is sent downstream; per-file deductions are then recorded as each
    // screening request is accepted.
    if (toProcess.length > 0) {
      try {
        await assertCreditsAvailable(toProcess.length, "cv_analysis");
      } catch (creditError) {
        if (creditError instanceof EllaCreditsError) {
          return responseError("Not enough Ella Credits to screen this batch. Top up Ella Credits to continue.", 402, {
            code: creditError.code,
            required: creditError.required,
            available: creditError.available,
          });
        }
        throw creditError;
      }
    }

    async function processFile({ file, queueId }: { file: File; sha256: string; queueId: string }) {
      let stored: Awaited<ReturnType<typeof storeResumeFile>> | null = null;
      let resolvedQueueId = queueId;
      const submittedAt = new Date().toISOString();
      try {
        if (file.size > MAX_RESUME_FILE_BYTES) throw new Error("Resume files must be 10 MB or smaller.");
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
          results.push({ fileName: file.name, queueId: resolvedQueueId, status: previousHasSavedResult ? "Screened" : previous?.status || "Queued", skipped: true, message: previousHasSavedResult || previousStatus === "screened" ? "This resume was already screened for this role." : previousStatus === "queued" ? "This resume is already queued for this role." : "This resume is already being screened for this role." });
          return;
        }

        const fileUrl = driveFileUrl(stored.record.fileId);
        const extractedContact = extractResumeContactDetails(stored.extractedText);
        // Save the processing row first. Downstream parsing can now fail
        // without making the upload disappear from Role Total.
        await appendBulkResumeQueueEvent({
          driveFileId: resolvedQueueId,
          driveFileName: stored.record.fileName,
          driveFileUrl: fileUrl,
          driveFileMimeType: stored.record.mimeType,
          roleId,
          candidateName: extractedContact.candidateName,
          candidateEmail: extractedContact.candidateEmail,
          status: "Processing",
          applicationId: `${isUat ? "UAT-" : ""}APP-${crypto.createHash("sha256").update(`${roleId}:${stored.record.sha256}`).digest("hex").slice(0, 24)}`,
          discoveredAt: submittedAt,
          processingStartedAt: submittedAt,
          attemptCount: String(Number(previous?.attemptCount || 0) + 1),
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
          applicationId: `${isUat ? "UAT-" : ""}APP-${crypto.createHash("sha256").update(`${roleId}:${stored.record.sha256}`).digest("hex").slice(0, 24)}`,
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
          source: isUat ? "Portal Bulk Upload (UAT)" : "Portal Bulk Upload",
          environment: isUat ? "uat" : environment,
          isUat,
          is_uat: isUat,
          attemptCount: String(Number(previous?.attemptCount || 0) + 1),
          jobId: resolvedQueueId,
        };
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Webhook-Secret": webhookSecret, "X-Idempotency-Key": resolvedQueueId },
          body: JSON.stringify(payload),
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`The screening workflow returned HTTP ${response.status}.`);
        // The screening request was accepted downstream: charge for it. A
        // ledger failure must not undo an accepted screening, so this only logs.
        creditedFiles += 1;
        await recordDeduction({
          event: "cv_analysis",
          units: 1,
          reference: resolvedQueueId,
          roleId,
          actorName,
          actorEmail,
          note: "Bulk resume screening",
        }).catch((creditError) => console.error("[Bulk Resume Upload] Could not record credit deduction:", creditError));
        const workflowResult = await response.json().catch(() => ({})) as Record<string, unknown>;
        // The active intake webhook uses an immediate acknowledgement. A 2xx
        // response therefore means only that n8n accepted the request; it does
        // not mean that candidate extraction, AI screening, and applicant
        // persistence have finished. Only an explicit terminal status from a
        // synchronous integration may be treated as terminal here. Otherwise
        // the queue poll remains the source of truth.
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
          applicationId: payload.applicationId,
          errorMessage: "",
          discoveredAt: payload.submittedAt,
          processingStartedAt: payload.submittedAt,
          processedAt: /^(screened|processed)$/i.test(terminalStatus) ? payload.submittedAt : "",
          attemptCount: String(Number(previous?.attemptCount || 0) + 1),
          lastUpdated: payload.submittedAt,
        };
        latestByFile.set(resolvedQueueId, queueItem);
        results.push({ fileName: stored.record.fileName, queueId: resolvedQueueId, applicationId: payload.applicationId, status: terminalStatus, driveFileUrl: fileUrl });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unable to submit this resume.";
        // Best effort only: if storage itself is unavailable, retain the
        // upload result in the response while avoiding a second failure.
        await appendBulkResumeQueueEvent({
          driveFileId: resolvedQueueId,
          driveFileName: stored?.record.fileName || file.name,
          driveFileUrl: stored ? driveFileUrl(stored.record.fileId) : "",
          driveFileMimeType: stored?.record.mimeType || file.type,
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
        }).catch((queueError) => console.error("[Bulk Resume Upload] Could not save failure queue event:", queueError));
        if (stored && !results.some((result) => result.queueId === queueIdForHash(roleId, stored?.record.sha256 || ""))) await deleteResumeFile(stored.record).catch(() => undefined);
        results.push({ fileName: file.name, queueId: resolvedQueueId, status: "Failed", error: errorMessage });
      }
    }

    // Controlled-concurrency worker pool: a fixed number of files are ever
    // in flight at once, each independently going through Drive storage +
    // the two-stage n8n screening chain. This is what raises throughput
    // beyond one-resume-at-a-time; it does not change what each file's
    // pipeline does, only how many run at the same time.
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
        await processFile(toProcess[index]);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));

    // Bulk completion emails are disabled by default while this feature is
    // rolled out; set BULK_RESUME_NOTIFY_ON_SUCCESS=true to re-enable them.
    // Keep the notification contract available for a synchronous/terminal
    // integration, but never emit a completion email for an asynchronous
    // acknowledgement. The queue remains authoritative for that case.
    const notifyOnSuccess = isEnabledChoice(portalConfig.Bulk_Resume_Notify_On_Success);
    let notificationStatus: "sent" | "failed" | "disabled" | "not_requested" = notifyOnSuccess ? "not_requested" : "disabled";
    const notificationUrl = portalConfig.N8N_Role_Webhook_URL.trim();
    const terminalResults = new Set(["screened", "processed", "failed", "skipped"]);
    const allResultsTerminal = results.length > 0 && results.every((result) => terminalResults.has(String(result.status || "").toLowerCase()));
    if (notifyOnSuccess && !isUat && allResultsTerminal && notificationUrl && webhookSecret && files.length > 0) {
      try {
        const notificationResponse = await fetch(notificationUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Webhook-Secret": webhookSecret, "X-Idempotency-Key": `bulk-batch-${batchId}` },
          body: JSON.stringify({
            eventType: "bulk_resume_batch_complete",
            batchId,
            roleId,
            roleTitle: role.jobTitle || "",
            submittedByEmail: user.email,
            totalFiles: files.length,
            submitted: results.filter((result) => ["Screened", "Processed"].includes(String(result.status))).length,
            skipped: results.filter((result) => result.skipped === true).length,
            failed: results.filter((result) => result.status === "Failed").length,
            results,
            completedAt: new Date().toISOString(),
            source: "Portal Bulk Upload",
          }),
          cache: "no-store",
        });
        notificationStatus = notificationResponse.ok ? "sent" : "failed";
      } catch (error) {
        // Upload success must not be rolled back because an internal alert is
        // temporarily unavailable; the queue records remain authoritative.
        console.error("[Bulk Resume Upload] completion notification failed:", error);
        notificationStatus = "failed";
      }
    }

    const submitted = results.filter((result) => !result.skipped && String(result.status || "").toLowerCase() !== "failed").length;
    const creditsCharged = creditedFiles * (await creditCostFor("cv_analysis"));
    return NextResponse.json({ success: true, roleId, batchId, environment: isUat ? "uat" : environment, isUat, results, notificationStatus, concurrency, submitted, creditsCharged }, { status: 202 });
  } catch (error) {
    console.error("[Bulk Resume Upload] POST failed:", error);
    return responseError(error instanceof Error ? error.message : "Unable to upload bulk resumes.", 400);
  }
}
