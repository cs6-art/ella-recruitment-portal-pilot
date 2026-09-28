import crypto from "node:crypto";

import { assertCreditsAvailable } from "@/lib/ella-credits";
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

// Unlike the legacy Sheets path this loop only talks to Postgres and blob
// storage -- no rate-limited external API -- so files can run concurrently
// instead of one at a time. Bounded (not Promise.all-everything) to avoid
// saturating the DB pool on a large MAX_FILES_PER_SUBMISSION batch.
const INTAKE_CONCURRENCY = 4;

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
  const results: Array<Record<string, unknown>> = new Array(input.sources.length);
  const creditsCharged = 0;
  let submitted = 0;

  // Files hash-identical to one already claimed in this same batch must be
  // skipped in-memory: with concurrent workers, two copies of the same resume
  // could otherwise both pass the DB dedupe check before either has written
  // its queue row. The check-and-add below is synchronous (no `await`
  // between the hash and the Set mutation), so it can't race across workers.
  const claimedShaInBatch = new Set<string>();

  // Hash every source up front, once, so (a) a source that can only be read
  // once (a Drive/OneDrive download) is never re-read, and (b) the credit
  // pre-check below can count real, non-duplicate files before any storage,
  // extraction, or queue write happens. A source that fails to download is
  // recorded as a per-file failure here and excluded from the credit count,
  // matching how it would have failed downstream before this change.
  const hashed = await Promise.all(input.sources.map(async (source, index) => {
    try {
      const bytes = await source.getBytes();
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      return { source, bytes, sha256, index, downloadError: null as string | null };
    } catch (error) {
      return { source, bytes: null as Buffer | null, sha256: "", index, downloadError: error instanceof Error ? error.message : "Unable to download the resume." };
    }
  }));
  const toProcess: typeof hashed = [];
  for (const item of hashed) {
    if (item.downloadError) {
      results[item.index] = { fileName: item.source.name, status: "Failed", stage: "source_download", error: item.downloadError };
      continue;
    }
    if (claimedShaInBatch.has(item.sha256)) {
      results[item.index] = { fileName: item.source.name, status: "Skipped", skipped: true, message: "Duplicate file selected in this same upload." };
      continue;
    }
    claimedShaInBatch.add(item.sha256);
    toProcess.push(item);
  }

  // Each resume that reaches the screening workflow costs 1 Smile Credit.
  // Pre-check the whole batch so an under-funded intake is refused before any
  // file is stored, extracted, or queued -- mirroring the Sheets-backend
  // intake path (bulk-resume-intake.ts), which this Postgres target path was
  // missing: zero-credit batches used to be queued in full and only fail,
  // one file at a time, once each was claimed for screening.
  if (toProcess.length > 0) {
    await assertCreditsAvailable(toProcess.length, "cv_analysis", { organizationId: input.organizationId, ownerEmail: input.actorEmail });
  }

  async function processSource(item: (typeof hashed)[number]): Promise<Record<string, unknown>> {
    const { source, bytes, sha256: sourceSha256 } = item;
    let stored: Awaited<ReturnType<typeof storeResumeFile>> | null = null;
    let queueKey = "";
    let durableQueue = false;
    let stage = "destination_storage";
    try {
      if (!bytes) throw new Error("Unable to download the resume.");
      if (bytes.length > MAX_RESUME_FILE_BYTES) throw new Error("Resume files must be 10 MB or smaller.");
      const existingQueue = await findBulkQueueByRoleAndSha(input.roleId, sourceSha256, input.organizationId);
      if (existingQueue) {
        return { fileName: source.name, status: "Skipped", skipped: true, message: "This resume is already queued or processed for this role." };
      }
      const file = new File([new Uint8Array(bytes)], source.name || "resume", { type: source.mimeType || "application/octet-stream" });
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
        return { fileName: source.name, queueId, status: "Skipped", skipped: true, message: "This resume is already queued or processed for this role." };
      }
      durableQueue = true;
      await updateBulkQueueStatus({ dedupeKey: queueId, status: "queued" });
      submitted += 1;
      return { fileName: stored.record.fileName, queueId, status: "Queued", driveFileUrl: driveFileUrl(stored.record.fileId) };
    } catch (error) {
      if (durableQueue && queueKey) {
        await updateBulkQueueStatus({ dedupeKey: queueKey, status: "failed", errorMessage: error instanceof Error ? error.message : "Unable to process the resume." }).catch(() => undefined);
      } else if (stored && !stored.reused) {
        await deleteResumeFile(stored.record).catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : "Unable to queue the resume.";
      console.warn("[Target Intake] failed", { batchId, stage, fileName: source.name, sourceFileId: source.driveFileId || "" });
      return { fileName: source.name, status: "Failed", stage, error: message };
    }
  }

  let cursor = 0;
  async function worker() {
    while (cursor < toProcess.length) {
      const item = toProcess[cursor++];
      results[item.index] = await processSource(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(INTAKE_CONCURRENCY, toProcess.length) }, worker));

  return { results, batchId, environment, isUat, notificationStatus: "disabled", concurrency: INTAKE_CONCURRENCY, submitted, creditsCharged };
}
