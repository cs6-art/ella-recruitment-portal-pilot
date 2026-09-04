import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { updateBulkQueueStatus } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withInternalAuth("bulk_queue", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.dedupeKey) && requiredString(item.status));
  });
  if (!body) return internalJson({ ok: false, error: "dedupeKey_and_status_required" }, 422);
  const result = await updateBulkQueueStatus({ dedupeKey: String(body.dedupeKey), status: String(body.status), applicationId: typeof body.applicationId === "string" ? body.applicationId : undefined, errorMessage: typeof body.errorMessage === "string" ? body.errorMessage : undefined });
  if (result.error) return internalJson({ ok: false, error: result.error }, 422);
  return internalJson({ ok: true, migrated: true, updated: result.updated });
});
