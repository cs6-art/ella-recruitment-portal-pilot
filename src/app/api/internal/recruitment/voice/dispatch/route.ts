import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { createVoiceCallLog, dispatchVoiceAttemptDryRun, voiceAttemptContext } from "@/lib/internal-recruitment-queries";
import { pilotVoiceDryRunEnabled } from "@/lib/pilot-test-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pilot target voice boundary. A real provider dispatch is deliberately not
 * implemented here. Target validation must opt into dry-run mode and receives
 * a synthetic provider call id that can be completed through the normal result
 * callback path.
 */
export const POST = withInternalAuth("voice_attempts", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.attemptId));
  });
  if (!body) return internalJson({ ok: false, error: "attemptId_required" }, 422);
  if (!pilotVoiceDryRunEnabled() || body.dryRun !== true) {
    return internalJson({ ok: false, error: "pilot_voice_dry_run_required" }, 409);
  }
  const attemptId = String(body.attemptId);
  const context = await voiceAttemptContext(attemptId);
  if (!context) return internalJson({ ok: false, error: "attempt_not_found" }, 404);
  const providerCallId = `pilot-dry-run-${attemptId}`;
  const attempt = await dispatchVoiceAttemptDryRun({ attemptId, providerCallId });
  if (!attempt) return internalJson({ ok: false, error: "attempt_not_in_calling_state" }, 409);
  const outboundPayload = {
    assistantId: process.env.PILOT_VAPI_ASSISTANT_ID?.trim() || "pilot-dry-run-assistant",
    phoneNumber: "",
    candidate: {
      name: context.candidateName,
      email: context.candidateEmail,
      roleId: context.roleExternalId || "",
      roleTitle: context.roleTitle || "",
      country: context.applicantCountry || "",
    },
    applicationId: context.applicationExternalId,
    scheduledAt: context.attempt.scheduledAt,
    attemptNumber: context.attempt.attemptNumber,
    maxAttempts: context.attempt.maxAttempts,
    callbackUrl: "/api/internal/recruitment/voice/results",
    testMode: true,
  };
  const log = await createVoiceCallLog({
    applicationExternalId: context.applicationExternalId,
    voiceCallAttemptId: attemptId,
    provider: "vapi-dry-run",
    providerCallId,
    sourceEventKey: `dry-run-dispatch:${attemptId}`,
    callStatus: "initiated",
    rawResult: { dryRun: true, liveCallPlaced: false, outboundPayload },
  });
  return internalJson({ ok: true, dryRun: true, liveCallPlaced: false, providerCallId, attempt, log: { id: log.log?.id || null, created: log.created }, outboundPayload });
});
