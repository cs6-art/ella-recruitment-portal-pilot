import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { processTargetCalendarEventQueue } from "@/lib/recruitment-target-portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Scheduled retry for booked face-to-face slots without a Calendar event. */
export const POST = withInternalAuth("booking", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => Boolean(value && typeof value === "object"));
  const limit = body && typeof body.limit === "number" ? body.limit : 10;
  return internalJson({ ok: true, migrated: true, ...(await processTargetCalendarEventQueue(limit)) });
});
