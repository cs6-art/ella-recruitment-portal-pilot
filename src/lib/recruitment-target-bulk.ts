import crypto from "node:crypto";

import { extractResumeContactDetails } from "@/lib/resume-contact-extraction";
import { bulkResumeEnvironment, bulkResumeIsUatMarked, productionUatBatchId } from "@/lib/bulk-resume-config";
import { deleteResumeFile, MAX_RESUME_FILE_BYTES, storeResumeFile } from "@/lib/resume-files";
import { enqueueBulkScreening, findBulkQueueByRoleAndSha, registerResumeFile, updateBulkQueueStatus } from "@/lib/internal-recruitment-queries";
import type { IntakeResult, IntakeSource } from "@/lib/bulk-resume-intake";

function queueIdForHash(roleId: string, sha256: string) {
  const roleKey = roleId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "-");
  return `BULK-${roleKey}-${sha256}`;
}

function driveFileUrl(fileId: string) {
  return fileId ? `https://drive.google.com/file/d/${fileId}/view` : "";
}

function fallbackCandidateName(fileName: string) {
  const words = fileName.replace(/\.[^.]+$/, "").replace(/[._-]+/g, " ").replace(/\b(resume|cv|curriculum vitae)\b/gi, " ").split(/\s+/).filter(Boolean);
  const name = words.map((word) => word ? `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}` : "").join(" ").trim();
  return name.split(" ").length >= 2 ? name : "Candidate";
}

/**
 * Postgres target intake. Importing a resume creates a durable queued work item
 * only. Screening owns the credit boundary: the applicant/application and
 * result are created atomically with the successful credit deduction.
 */
export async function intakeTargetResumeBatch(input: {
  roleId: string;
  roleTitle: string;
  actorName: string;
  actorEmail: string;
  organizationId: string;
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
      const sourceSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      const existingQueue = await findBulkQueueByRoleAndSha(input.roleId, sourceSha256, input.organizationId);
      if (existingQueue) {
        results.push({ fileName: source.name, status: "Skipped", skipped: true, message: "This resume is already queued or processed for this role." });
        continue;
      }
      const file = new File([new Uint8Array(bytes)], source.name || "resume", { type: source.mimeType || "application/octet-stream" });
      stage = "destination_storage";
      stored = await storeResumeFile(file, { environment, organizationId: input.organizationId });
      stage = "contact_extraction";
      const queueId = queueIdForHash(input.roleId, stored.record.sha256);
      queueKey = queueId;
      const contact = extractResumeContactDetails(stored.extractedText);
      const candidateName = contact.candidateName || fallbackCandidateName(source.name);
      if (!contact.candidateEmail) throw new Error("The resume must contain a readable candidate email address.");
      stage = "resume_persistence";

      // Keep the uploaded resume and its extracted candidate details durable,
      // but do not create an applicant/application yet. The AI worker owns the
      // credit boundary; finalizeBulkScreening creates the applicant,
      // application, result, history, and ledger entry in one transaction only
      // after the credit guard succeeds. This prevents exhausted-credit runs
      // from leaving visible applicant records with no paid screening.
      await registerResumeFile({
        storageRef: stored.record.fileId,
        sha256: stored.record.sha256,
        filename: stored.record.fileName,
        mimeType: stored.record.mimeType,
        size: stored.record.size,
        kind: stored.record.kind,
        expiresAt: stored.record.expiresAt,
        extractedText: stored.extractedText,
        candidateName: contact.candidateName,
        candidateEmail: contact.candidateEmail,
        preferredMobile: contact.preferredMobile,
        applicantCountry: contact.applicantCountry,
        organizationId: input.organizationId,
      });

      stage = "queue_persistence";
      const queued = await enqueueBulkScreening({
        roleExternalId: input.roleId,
        organizationId: input.organizationId,
        batchId,
        dedupeKey: queueId,
        resumeSha256: stored.record.sha256,
        driveFileId: source.driveFileId || stored.record.fileId,
        filename: stored.record.fileName,
        fileUrl: driveFileUrl(stored.record.fileId),
        mimeType: stored.record.mimeType,
        candidateName,
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
      await updateBulkQueueStatus({ dedupeKey: queueId, status: "queued" });
      submitted += 1;
      results.push({ fileName: stored.record.fileName, queueId, status: "Queued", driveFileUrl: driveFileUrl(stored.record.fileId) });
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
