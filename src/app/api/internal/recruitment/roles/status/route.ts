import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { updateRoleStatus } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withInternalAuth("roles", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.externalId) && requiredString(item.newStatus) && requiredString(item.actionRequestId));
  });
  if (!body) return internalJson({ ok: false, error: "externalId_newStatus_actionRequestId_required" }, 422);
  const result = await updateRoleStatus({ externalId: String(body.externalId), newStatus: String(body.newStatus), actionRequestId: String(body.actionRequestId), actorEmail: typeof body.actorEmail === "string" ? body.actorEmail : undefined, actorName: typeof body.actorName === "string" ? body.actorName : undefined, comments: typeof body.comments === "string" ? body.comments : undefined });
  if (result.error === "unknown_role") return internalJson({ ok: false, error: result.error }, 404);
  if (result.error) return internalJson({ ok: false, error: result.error }, 422);
  return internalJson({ ok: true, migrated: true, updated: result.updated, duplicate: result.duplicate || false });
});
