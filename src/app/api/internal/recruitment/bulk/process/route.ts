import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { processTargetBulkScreening } from "@/lib/recruitment-target-screening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Process exactly one claimed Pilot Postgres bulk item. */
export const POST = withInternalAuth("bulk_queue", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.dedupeKey));
  });
  if (!body) return internalJson({ ok: false, error: "dedupeKey_required" }, 422);

  const result = await processTargetBulkScreening({
    dedupeKey: String(body.dedupeKey),
    actorEmail: typeof body.actorEmail === "string" ? body.actorEmail : undefined,
    actorName: typeof body.actorName === "string" ? body.actorName : undefined,
  });
  if (result.status === "failed") {
    const status = result.error === "unknown_queue" ? 404 : result.error === "queue_not_processable" || result.error === "queue_claim_conflict" ? 409 : 502;
    return internalJson({ ok: false, error: result.error }, status);
  }
  return internalJson({ ok: true, migrated: true, ...result }, 200);
});
