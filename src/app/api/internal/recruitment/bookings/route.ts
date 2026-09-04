import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { bookInterviewSlot, listBookingSlots } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withInternalAuth("booking", async (request) => {
  const params = new URL(request.url).searchParams;
  return internalJson({ ok: true, migrated: true, items: await listBookingSlots(params.get("kind") || undefined, params.get("roleExternalId") || undefined) });
});

export const POST = withInternalAuth("booking", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.slotId) && requiredString(item.applicationExternalId) && requiredString(item.actorEmail) && requiredString(item.actionRequestId));
  });
  if (!body) return internalJson({ ok: false, error: "slot_application_actor_actionRequestId_required" }, 422);
  const result = await bookInterviewSlot({ slotId: String(body.slotId), applicationExternalId: String(body.applicationExternalId), actorEmail: String(body.actorEmail), actionRequestId: String(body.actionRequestId) });
  if (result.error === "unknown_application") return internalJson({ ok: false, error: result.error }, 404);
  if (result.error) return internalJson({ ok: false, error: result.error }, 409);
  return internalJson({ ok: true, migrated: true, booked: result.booked, slot: result.slot }, 201);
});
