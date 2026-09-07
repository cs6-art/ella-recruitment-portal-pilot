import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { scheduleVoiceRetry } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withInternalAuth("voice_attempts", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.attemptId) && requiredString(item.retryAfter));
  });
  if (!body) return internalJson({ ok: false, error: "attemptId_and_retryAfter_required" }, 422);
  const result = await scheduleVoiceRetry({ attemptId: String(body.attemptId), retryAfter: String(body.retryAfter) });
  if (result.error) return internalJson({ ok: false, error: result.error }, result.error === "attempt_not_found" ? 404 : 409);
  return internalJson({ ok: true, scheduled: result.scheduled, duplicate: result.duplicate, terminal: result.terminal, next: result.next || null });
});
