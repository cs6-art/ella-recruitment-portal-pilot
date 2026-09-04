import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { applyHrDecision } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withInternalAuth("hr_decisions", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.applicationExternalId) && requiredString(item.stage) && requiredString(item.decision) && requiredString(item.actorEmail) && requiredString(item.actionRequestId));
  });
  if (!body) return internalJson({ ok: false, error: "application_stage_decision_actor_actionRequestId_required" }, 422);
  if (!["resume", "voice", "final"].includes(String(body.stage))) return internalJson({ ok: false, error: "invalid_stage" }, 422);
  const result = await applyHrDecision({ applicationExternalId: String(body.applicationExternalId), stage: String(body.stage) as "resume" | "voice" | "final", decision: String(body.decision), comments: typeof body.comments === "string" ? body.comments : undefined, actorEmail: String(body.actorEmail), actorName: typeof body.actorName === "string" ? body.actorName : undefined, actionRequestId: String(body.actionRequestId) });
  if (result.error === "unknown_application") return internalJson({ ok: false, error: result.error }, 404);
  if (result.error) return internalJson({ ok: false, error: result.error }, 422);
  return internalJson({ ok: true, migrated: true, updated: result.updated, duplicate: result.duplicate || false });
});
