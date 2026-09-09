import crypto from "node:crypto";

import { extractResumeContactDetails } from "@/lib/resume-contact-extraction";
import { bulkResumeEnvironment, bulkResumeIsUatMarked, productionUatBatchId } from "@/lib/bulk-resume-config";
import { deleteResumeFile, MAX_RESUME_FILE_BYTES, storeResumeFile } from "@/lib/resume-files";
import { createApplication, enqueueBulkScreening, registerResumeFile, updateBulkQueueStatus } from "@/lib/internal-recruitment-queries";
import type { IntakeResult, IntakeSource } from "@/lib/bulk-resume-intake";

function queueIdForHash(roleId: string, sha256: string) {
  const roleKey = roleId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "-");
  return `BULK-${roleKey}-${sha256}`;
}

function driveFileUrl(fileId: string) {
  return fileId ? `https://drive.google.com/file/d/${fileId}/view` : "";
}

/**
 * Postgres target intake. Importing a resume creates a durable queued item and
 * application only. Screening owns the credit boundary: failed or unprocessed
 * resumes never consume credits.
 */
export async function intakeTargetResumeBatch(input: {
  roleId: string;
  roleTitle: string;
  actorName: string;
  actorEmail: string;
  submittedByEmail: string;
  sources: IntakeSource[];
  sourceLabel: string;
  uatRecoveryToken?: string;
}): Promise<IntakeResult> {
  const environment = bulkResumeEnvironment();
  const isUat = bulkResumeIsUatMarked();
  const batchId = productionUatBatchId() || `${isUat ? "UAT-BATCH" : "BATCH"}-${crypto.randomUUID()}`;
  const results: Array<Record<string, unknown>> = [];
  const creditsCharged = 0;
  let submitted = 0;

  for (const source of input.sources) {
    let stored: Awaited<ReturnType<typeof storeResumeFile>> | null = null;
    let queueKey = "";
    let durableQueue = false;
    let stage = "source_download";
    try {
      const bytes = await source.getBytes();
      if (bytes.length > MAX_RESUME_FILE_BYTES) throw new Error("Resume files must be 10 MB or smaller.");
      const file = new File([new Uint8Array(bytes)], source.name || "resume", { type: source.mimeType || "application/octet-stream" });
      stage = "destination_storage";
      stored = await storeResumeFile(file, { environment });
      stage = "contact_extraction";
      const queueId = queueIdForHash(input.roleId, stored.record.sha256);
      queueKey = queueId;
      const contact = extractResumeContactDetails(stored.extractedText);
      if (!contact.candidateEmail) throw new Error("The resume must contain a readable candidate email address.");
      stage = "application_persistence";

      const applicationId = `APP-${crypto.createHash("sha256").update(`${input.roleId}:${stored.record.sha256}`).digest("hex").slice(0, 24)}`;
      const resumeFileId = await registerResumeFile({
        storageRef: stored.record.fileId,
        sha256: stored.record.sha256,
        filename: stored.record.fileName,
        mimeType: stored.record.mimeType,
        size: stored.record.size,
        kind: stored.record.kind,
        expiresAt: stored.record.expiresAt,
      });
      const application = await createApplication({
        externalId: applicationId,
        applicantEmail: contact.candidateEmail,
        applicantName: contact.candidateName || source.name.replace(/\.[^.]+$/, ""),
        phone: contact.preferredMobile,
        preferredMobile: contact.preferredMobile,
        applicantCountry: contact.applicantCountry,
        roleExternalId: input.roleId,
        source: input.sourceLabel.toLowerCase().includes("drive") ? "drive_import" : "bulk_upload",
        sourceDetail: `${source.driveFileId || stored.record.fileId}|${stored.record.sha256}`,
        resumeFileId: resumeFileId || undefined,
      });
      if (!application.application) {
        throw new Error(application.error || "Unable to create the application.");
      }

      // Attach the application in the initial INSERT. A queue row with a
      // null application_id is immediately claimable; a concurrent worker
      // could otherwise process it between enqueue and this update, fail with
      // missing_application, and never reach the credit boundary.
      stage = "queue_persistence";
      const queued = await enqueueBulkScreening({
        roleExternalId: input.roleId,
        applicationExternalId: applicationId,
        batchId,
        dedupeKey: queueId,
        resumeSha256: stored.record.sha256,
        driveFileId: source.driveFileId || stored.record.fileId,
        filename: stored.record.fileName,
        fileUrl: driveFileUrl(stored.record.fileId),
        mimeType: stored.record.mimeType,
        candidateName: contact.candidateName,
        candidateEmail: contact.candidateEmail,
        preferredMobile: contact.preferredMobile,
        applicantCountry: contact.applicantCountry,
        source: input.sourceLabel.toLowerCase().includes("drive") ? "drive" : "upload",
        environment,
        isUat,
        jobId: queueId,
      });
      if (!queued.item) throw new Error(queued.error || "Unable to enqueue the resume.");
      if (!queued.created) {
        if (!stored.reused) await deleteResumeFile(stored.record).catch(() => undefined);
        results.push({ fileName: source.name, queueId, status: "Skipped", skipped: true, message: "This resume is already queued or processed for this role." });
        continue;
      }
      durableQueue = true;
      await updateBulkQueueStatus({ dedupeKey: queueId, status: "queued", applicationId: application.application.id });
      submitted += 1;
      results.push({ fileName: stored.record.fileName, queueId, applicationId, status: "Queued", driveFileUrl: driveFileUrl(stored.record.fileId) });
    } catch (error) {
      if (durableQueue && queueKey) {
        await updateBulkQueueStatus({ dedupeKey: queueKey, status: "failed", errorMessage: error instanceof Error ? error.message : "Unable to process the resume." }).catch(() => undefined);
      } else if (stored && !stored.reused) {
        await deleteResumeFile(stored.record).catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : "Unable to queue the resume.";
      console.warn("[Target Intake] failed", { batchId, stage, fileName: source.name, sourceFileId: source.driveFileId || "" });
      results.push({ fileName: source.name, status: "Failed", stage, error: message });
    }
  }

  return { results, batchId, environment, isUat, notificationStatus: "disabled", concurrency: 1, submitted, creditsCharged };
}
