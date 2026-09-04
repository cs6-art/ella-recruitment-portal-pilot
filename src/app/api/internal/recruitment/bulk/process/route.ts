import { extractStoredResumeText, type ResumeFileKind, type ResumeFileRecord } from "@/lib/resume-files";
import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { getBulkScreeningContext } from "@/lib/internal-recruitment-queries";
import { processTargetBulkScreening } from "@/lib/recruitment-target-screening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function dateText(value: unknown) {
  return value instanceof Date ? value.toISOString() : text(value);
}

function storedResumeRecord(value: Record<string, unknown>): ResumeFileRecord {
  const kind = text(value.kind);
  if (kind !== "pdf" && kind !== "docx" && kind !== "doc") throw new Error("resume_file_kind_invalid");
  return {
    fileId: text(value.storageRef), fileName: text(value.filename), mimeType: text(value.mimeType),
    size: Number(value.size) || 0, sha256: text(value.sha256), uploadedAt: dateText(value.uploadedAt),
    expiresAt: dateText(value.expiresAt), kind: kind as ResumeFileKind,
  };
}

/** Return the claimed item's role and resume context to the n8n AI worker. */
export const GET = withInternalAuth("bulk_queue", async (request) => {
  const dedupeKey = new URL(request.url).searchParams.get("dedupeKey")?.trim() || "";
  if (!dedupeKey) return internalJson({ ok: false, error: "dedupeKey_required" }, 422);
  const context = await getBulkScreeningContext(dedupeKey);
  if (!context) return internalJson({ ok: false, error: "unknown_queue" }, 404);
  if (!context.application || !context.resumeFile) return internalJson({ ok: false, error: "missing_application_or_resume" }, 409);
  const resumeText = await extractStoredResumeText(storedResumeRecord(context.resumeFile as unknown as Record<string, unknown>));
  const setup = context.role.setup && typeof context.role.setup === "object" && !Array.isArray(context.role.setup) ? context.role.setup as Record<string, unknown> : {};
  return internalJson({
    ok: true,
    context: {
      dedupeKey,
      status: context.item.status,
      role: {
        externalId: context.role.externalId,
        title: context.role.title,
        department: context.role.departmentSnapshot,
        jobDescription: text(setup.jobDescription),
        screeningCriteria: text(setup.screeningCriteria),
        keywordsToLookFor: text(setup.keywordsToLookFor),
        minimumYearsOfExperience: text(setup.minimumYearsOfExperience),
        transferableSkillsAccepted: text(setup.transferableSkillsAccepted),
        licenseOrCertificateRequired: text(setup.licenseOrCertificateRequired),
        aiSystemPrompt: text(setup.aiSystemPrompt),
      },
      candidate: {
        applicationId: context.application.externalId,
        name: context.application.candidateName || context.item.candidateName,
        email: context.application.email || context.item.candidateEmail,
        phone: context.application.phone || context.item.preferredMobile,
      },
      resumeText,
    },
  });
});

/** Persist one n8n-produced, strictly validated screening result. */
export const POST = withInternalAuth("bulk_queue", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.dedupeKey) && item.screening !== undefined);
  });
  if (!body) return internalJson({ ok: false, error: "dedupeKey_and_screening_required" }, 422);

  const result = await processTargetBulkScreening({
    dedupeKey: String(body.dedupeKey),
    screening: body.screening,
    actorEmail: typeof body.actorEmail === "string" ? body.actorEmail : undefined,
    actorName: typeof body.actorName === "string" ? body.actorName : undefined,
  });
  if (result.status === "failed") {
    const status = result.error === "unknown_queue" ? 404 : result.error === "queue_not_processable" || result.error === "queue_claim_conflict" ? 409 : 502;
    return internalJson({ ok: false, error: result.error }, status);
  }
  return internalJson({ ok: true, migrated: true, ...result }, 200);
});
