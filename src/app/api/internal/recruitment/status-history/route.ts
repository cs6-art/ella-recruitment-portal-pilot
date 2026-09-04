import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { listApplicationHistory, updateApplicationStage } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withInternalAuth("status_history", async (request) => {
  return internalJson({ ok: true, migrated: true, items: await listApplicationHistory(new URL(request.url).searchParams.get("applicationExternalId") || undefined) });
});

export const POST = withInternalAuth("status_history", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.applicationExternalId) && requiredString(item.newStage) && requiredString(item.actionRequestId));
  });
  if (!body) return internalJson({ ok: false, error: "applicationExternalId_newStage_actionRequestId_required" }, 422);
  const result = await updateApplicationStage({ applicationExternalId: String(body.applicationExternalId), newStage: String(body.newStage), actorEmail: typeof body.actorEmail === "string" ? body.actorEmail : undefined, actorName: typeof body.actorName === "string" ? body.actorName : undefined, comments: typeof body.comments === "string" ? body.comments : undefined, actionRequestId: String(body.actionRequestId) });
  if (result.error === "unknown_application") return internalJson({ ok: false, error: result.error }, 404);
  if (result.error) return internalJson({ ok: false, error: result.error }, 422);
  return internalJson({ ok: true, migrated: true, updated: result.updated, duplicate: result.duplicate || false });
});
