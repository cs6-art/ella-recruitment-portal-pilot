import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { createInterviewSlot } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withInternalAuth("booking", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.interviewType) && requiredString(item.startsAt) && requiredString(item.endsAt) && requiredString(item.timezone));
  });
  if (!body) return internalJson({ ok: false, error: "interviewType_startsAt_endsAt_timezone_required" }, 422);
  if (body.interviewType !== "voice" && body.interviewType !== "final") return internalJson({ ok: false, error: "invalid_interview_type" }, 422);
  const result = await createInterviewSlot({ interviewType: body.interviewType, slotCode: typeof body.slotCode === "string" ? body.slotCode : undefined, roleExternalId: typeof body.roleExternalId === "string" ? body.roleExternalId : undefined, startsAt: String(body.startsAt), endsAt: String(body.endsAt), timezone: String(body.timezone) });
  if (result.error === "unknown_role") return internalJson({ ok: false, error: result.error }, 404);
  if (result.error) return internalJson({ ok: false, error: result.error }, 422);
  return internalJson({ ok: true, migrated: true, created: result.created, slot: result.slot }, result.created ? 201 : 200);
});
