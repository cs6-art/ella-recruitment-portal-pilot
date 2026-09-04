import crypto from "node:crypto";

import { creditCostFor, EllaCreditsError } from "@/lib/ella-credits";
import {
  claimBulkQueueItem,
  finalizeBulkScreening,
  getBulkScreeningContext,
  updateBulkQueueStatus,
} from "@/lib/internal-recruitment-queries";
import { extractStoredResumeText, type ResumeFileKind, type ResumeFileRecord } from "@/lib/resume-files";
import { screenResume, screeningDbValues } from "@/lib/recruitment-screening";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dateText(value: unknown) {
  return value instanceof Date ? value.toISOString() : text(value);
}

function storedResumeRecord(value: Record<string, unknown>): ResumeFileRecord {
  const kind = text(value.kind);
  if (kind !== "pdf" && kind !== "docx" && kind !== "doc") throw new Error("resume_file_kind_invalid");
  return {
    fileId: text(value.storageRef),
    fileName: text(value.filename),
    mimeType: text(value.mimeType),
    size: Number(value.size) || 0,
    sha256: text(value.sha256),
    uploadedAt: dateText(value.uploadedAt),
    expiresAt: dateText(value.expiresAt),
    kind: kind as ResumeFileKind,
  };
}

/**
 * Process one claimed target queue item. Queue claim is atomic, and the final
 * result + history + charge is committed by finalizeBulkScreening atomically.
 */
export async function processTargetBulkScreening(input: {
  dedupeKey: string;
  actorEmail?: string;
  actorName?: string;
}) {
  const dedupeKey = input.dedupeKey.trim();
  if (!dedupeKey) return { status: "failed" as const, error: "dedupeKey_required" };

  let context = await getBulkScreeningContext(dedupeKey);
  if (!context) return { status: "failed" as const, error: "unknown_queue" };
  if (context.item.status === "screened") return { status: "duplicate" as const, dedupeKey };
  if (context.item.status === "queued" || context.item.status === "failed") {
    const claimed = await claimBulkQueueItem(dedupeKey);
    if (!claimed) {
      context = await getBulkScreeningContext(dedupeKey);
      if (!context || context.item.status === "screened") return { status: "duplicate" as const, dedupeKey };
      if (context.item.status !== "processing") return { status: "failed" as const, error: "queue_claim_conflict" };
    }
  }
  if (context.item.status !== "processing" && context.item.status !== "queued" && context.item.status !== "failed") {
    return { status: "failed" as const, error: "queue_not_processable" };
  }
  if (!context.application || !context.resumeFile) return { status: "failed" as const, error: "missing_application_or_resume" };

  try {
    const resume = storedResumeRecord(context.resumeFile as unknown as Record<string, unknown>);
    const resumeText = await extractStoredResumeText(resume);
    const setup = object(context.role.setup);
    const aiResult = await screenResume({
      roleTitle: text(context.role.title),
      jobDescription: text(setup.jobDescription),
      screeningCriteria: text(setup.screeningCriteria),
      keywordsToLookFor: text(setup.keywordsToLookFor),
      minimumYearsOfExperience: text(setup.minimumYearsOfExperience),
      transferableSkillsAccepted: text(setup.transferableSkillsAccepted),
      licenseOrCertificateRequired: text(setup.licenseOrCertificateRequired),
      candidateName: text(context.application.candidateName || context.item.candidateName),
      candidateEmail: text(context.application.email || context.item.candidateEmail),
      resumeText,
    });
    const cost = await creditCostFor("cv_analysis");
    const result = await finalizeBulkScreening({
      dedupeKey,
      screening: { ...screeningDbValues(aiResult), raw: aiResult },
      ledger: {
        type: "Deduction",
        event: "cv_analysis",
        units: 1,
        creditsDelta: -cost,
        reference: dedupeKey,
        roleId: text(context.role.externalId),
        actorName: input.actorName || "",
        actorEmail: input.actorEmail || "",
        note: "Postgres target bulk resume screening",
        sourceEntryId: `LDG-${crypto.createHash("sha256").update(`cv:${dedupeKey}`).digest("hex")}`,
      },
      actorEmail: input.actorEmail,
      actorName: input.actorName,
    });
    if (result.duplicate) return { status: "duplicate" as const, dedupeKey };
    if (result.error) return { status: "failed" as const, error: result.error };
    return { status: "screened" as const, dedupeKey, applicationId: context.application.externalId, creditApplied: result.credit?.applied === true };
  } catch (error) {
    const message = error instanceof EllaCreditsError ? "insufficient_credits" : error instanceof Error ? error.message : "screening_failed";
    await updateBulkQueueStatus({ dedupeKey, status: "failed", errorMessage: message }).catch(() => undefined);
    return { status: "failed" as const, error: message };
  }
}
