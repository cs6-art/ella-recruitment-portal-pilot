import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { bulkScreeningQueue, enqueueBulkScreening } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bulk resume screening queue — replaces the n8n Bulk_Resume_Queue poll.
// ?status=queued,processing (default) | screened | failed | skipped
export const GET = withInternalAuth("bulk_queue", async (request) => {
  const statuses = (new URL(request.url).searchParams.get("status") || "queued,processing")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => ["queued", "processing", "screened", "failed", "skipped"].includes(value));
  const items = await bulkScreeningQueue(statuses.length > 0 ? statuses : ["queued", "processing"]);
  return internalJson({ ok: true, migrated: true, count: items.length, items });
});

export const POST = withInternalAuth("bulk_queue", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.roleExternalId) && requiredString(item.dedupeKey) && requiredString(item.resumeSha256) && requiredString(item.driveFileId) && requiredString(item.filename));
  });
  if (!body) return internalJson({ ok: false, error: "roleExternalId_dedupeKey_resumeSha256_driveFileId_filename_required" }, 422);
  const source = body.source === "upload" || body.source === "drive" || body.source === "onedrive" ? body.source : undefined;
  const result = await enqueueBulkScreening({ roleExternalId: String(body.roleExternalId), dedupeKey: String(body.dedupeKey), resumeSha256: String(body.resumeSha256), driveFileId: String(body.driveFileId), filename: String(body.filename), batchId: typeof body.batchId === "string" ? body.batchId : undefined, fileUrl: typeof body.fileUrl === "string" ? body.fileUrl : undefined, mimeType: typeof body.mimeType === "string" ? body.mimeType : undefined, candidateName: typeof body.candidateName === "string" ? body.candidateName : undefined, candidateEmail: typeof body.candidateEmail === "string" ? body.candidateEmail : undefined, preferredMobile: typeof body.preferredMobile === "string" ? body.preferredMobile : undefined, applicantCountry: typeof body.applicantCountry === "string" ? body.applicantCountry : undefined, source, environment: typeof body.environment === "string" ? body.environment : undefined, isUat: body.isUat === true, jobId: typeof body.jobId === "string" ? body.jobId : undefined });
  if (result.error === "unknown_role") return internalJson({ ok: false, error: result.error }, 404);
  return internalJson({ ok: true, migrated: true, created: result.created, item: result.item }, result.created ? 201 : 200);
});
