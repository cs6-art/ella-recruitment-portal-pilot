import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { markNotification, notificationQueue } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withInternalAuth("notifications", async (request) => {
  const stage = new URL(request.url).searchParams.get("stage") || undefined;
  return internalJson({ ok: true, migrated: true, items: await notificationQueue(stage) });
});

export const POST = withInternalAuth("notifications", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.historyId) && requiredString(item.status));
  });
  if (!body) return internalJson({ ok: false, error: "historyId_and_status_required" }, 422);
  if (!["sent", "pending", "failed", "not_configured"].includes(String(body.status))) return internalJson({ ok: false, error: "invalid_notification_status" }, 422);
  const result = await markNotification({ historyId: String(body.historyId), status: String(body.status) as "sent" | "pending" | "failed" | "not_configured", error: typeof body.error === "string" ? body.error : undefined });
  return internalJson({ ok: true, migrated: true, updated: result.updated });
});
