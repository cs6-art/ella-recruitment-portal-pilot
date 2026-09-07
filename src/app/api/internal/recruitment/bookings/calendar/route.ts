import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { calendarEventQueue, markInterviewCalendarEvent } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Face-to-face slots still awaiting a Google Calendar event from the n8n target workflow. */
export const GET = withInternalAuth("booking", async () => {
  return internalJson({ ok: true, migrated: true, items: await calendarEventQueue() });
});

/**
 * Write-back for the n8n Google Calendar node. Idempotent: a replayed "created"
 * callback never records a second event id for a slot that already has one.
 */
export const POST = withInternalAuth("booking", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    if (!item) return false;
    const hasTarget = requiredString(item.slotId) || requiredString(item.slotCode) || (requiredString(item.applicationExternalId) && (item.interviewType === "voice" || item.interviewType === "final"));
    return hasTarget && ["created", "updated", "failed", "skipped"].includes(String(item.status));
  });
  if (!body) return internalJson({ ok: false, error: "target_and_status_required" }, 422);
  const result = await markInterviewCalendarEvent({
    slotId: typeof body.slotId === "string" ? body.slotId : undefined,
    slotCode: typeof body.slotCode === "string" ? body.slotCode : undefined,
    applicationExternalId: typeof body.applicationExternalId === "string" ? body.applicationExternalId : undefined,
    interviewType: body.interviewType === "voice" || body.interviewType === "final" ? body.interviewType : undefined,
    status: String(body.status) as "created" | "updated" | "failed" | "skipped",
    eventId: typeof body.eventId === "string" ? body.eventId : undefined,
    eventLink: typeof body.eventLink === "string" ? body.eventLink : undefined,
    error: typeof body.error === "string" ? body.error : undefined,
  });
  if (result.error === "slot_not_found") return internalJson({ ok: false, error: result.error }, 404);
  return internalJson({ ok: true, migrated: true, updated: result.updated, duplicate: result.duplicate, eventId: result.eventId, error: result.error ?? undefined });
});
