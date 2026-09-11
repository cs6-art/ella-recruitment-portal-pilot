import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { updateVoiceAttemptStatus } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withInternalAuth("voice_attempts", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.attemptId) && requiredString(item.status));
  });
  if (!body) return internalJson({ ok: false, error: "attemptId_and_status_required" }, 422);
  const result = await updateVoiceAttemptStatus({ attemptId: String(body.attemptId), status: String(body.status), outcome: typeof body.outcome === "string" ? body.outcome : undefined, providerCallId: typeof body.providerCallId === "string" ? body.providerCallId : undefined, retryAfter: typeof body.retryAfter === "string" ? body.retryAfter : undefined, reason: typeof body.reason === "string" ? body.reason.slice(0, 2000) : undefined });
  if (result.error) return internalJson({ ok: false, error: result.error }, 422);
  return internalJson({ ok: true, migrated: true, updated: result.updated, chargedCredits: result.chargedCredits || 0, billingOutcome: result.billingOutcome || null });
});
