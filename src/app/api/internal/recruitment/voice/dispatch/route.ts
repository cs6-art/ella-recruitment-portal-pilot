import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { assertCreditsAvailable, EllaCreditsError } from "@/lib/ella-credits";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import {
  beginVoiceAttemptDispatch,
  blockVoiceAttempt,
  createVoiceCallLog,
  dispatchVoiceAttemptDryRun,
  failVoiceAttemptDispatch,
  listApplicationSlots,
  recordVoiceAttemptProviderCall,
  voiceAttemptContext,
} from "@/lib/internal-recruitment-queries";
import { pilotVoiceDryRunEnabled } from "@/lib/pilot-test-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePhone(value: unknown) {
  const normalized = String(value ?? "").trim().replace(/[\s().-]+/g, "");
  if (/^00[1-9]\d{7,14}$/.test(normalized)) return `+${normalized.slice(2)}`;
  return normalized;
}

function configured(name: string, fallbackName?: string) {
  return process.env[name]?.trim() || (fallbackName ? process.env[fallbackName]?.trim() : "") || "";
}

function isDue(value: unknown) {
  return value instanceof Date && !Number.isNaN(value.valueOf()) && value.getTime() <= Date.now();
}

/**
 * Dispatch one claimed attempt. Safe mode produces a synthetic call; live mode
 * calls Vapi only after the database claim and all applicant/booking checks
 * pass. The `dispatching` state is the exactly-once barrier for retries.
 */
export const POST = withInternalAuth("voice_attempts", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.attemptId));
  });
  if (!body) return internalJson({ ok: false, error: "attemptId_required" }, 422);

  const attemptId = String(body.attemptId).trim();
  const context = await voiceAttemptContext(attemptId);
  if (!context) return internalJson({ ok: false, error: "attempt_not_found" }, 404);

  const dryRun = body.dryRun === true || pilotVoiceDryRunEnabled();
  if (dryRun) {
    const providerCallId = `pilot-dry-run-${attemptId}`;
    const attempt = await dispatchVoiceAttemptDryRun({ attemptId, providerCallId });
    if (!attempt) return internalJson({ ok: false, error: "attempt_not_in_calling_state" }, 409);
    const phoneNumber = normalizePhone(context.applicantPhone || context.preferredMobile || context.phone || context.attempt.preferredMobile || context.attempt.contactNumber);
    const outboundPayload = {
      assistantId: configured("PILOT_VAPI_ASSISTANT_ID", "VAPI_ASSISTANT_ID") || "pilot-dry-run-assistant",
      phoneNumber,
      customer: { name: context.candidateName, email: context.candidateEmail, number: phoneNumber },
      candidate: { name: context.candidateName, email: context.candidateEmail, roleId: context.roleExternalId || "", roleTitle: context.roleTitle || "", country: context.applicantCountry || "" },
      applicationId: context.applicationExternalId,
      attemptId,
      scheduledAt: context.attempt.scheduledAt,
      attemptNumber: context.attempt.attemptNumber,
      maxAttempts: context.attempt.maxAttempts,
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
  }

  const block = async (error: string, status: number) => {
    await blockVoiceAttempt(attemptId, error).catch(() => undefined);
    return internalJson({ ok: false, error }, status);
  };
  if (context.withdrawn || context.currentStage !== "voice_scheduled") return block("applicant_not_eligible_for_voice", 409);
  if (context.attempt.status !== "calling") return internalJson({ ok: false, error: "attempt_not_claimed" }, 409);
  if (!isDue(context.attempt.scheduledAt)) return block("voice_slot_not_due", 409);

  const bookedSlots = await listApplicationSlots(context.applicationExternalId, "voice");
  const bookedSlot = bookedSlots.find(({ slot }) => slot.status === "booked" && context.attempt.scheduledAt && slot.startsAt.getTime() === context.attempt.scheduledAt.getTime());
  if (!bookedSlot) return block("active_voice_booking_required", 409);

  const phoneNumber = normalizePhone(context.applicantPhone || context.preferredMobile || context.phone || context.attempt.preferredMobile || context.attempt.contactNumber);
  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) return block("valid_applicant_phone_required", 422);

  try {
    await assertCreditsAvailable(1, "phone_interview");
  } catch (error) {
    if (error instanceof EllaCreditsError) {
      await blockVoiceAttempt(attemptId, "insufficient_voice_credits").catch(() => undefined);
      return internalJson({ ok: false, error: "insufficient_voice_credits", required: error.required, available: error.available }, 402);
    }
    throw error;
  }

  const apiKey = configured("PILOT_VAPI_API_KEY", "VAPI_API_KEY");
  const assistantId = configured("PILOT_VAPI_ASSISTANT_ID", "VAPI_ASSISTANT_ID");
  const phoneNumberId = configured("PILOT_VAPI_PHONE_NUMBER_ID", "VAPI_PHONE_NUMBER_ID");
  if (!apiKey || !assistantId || !phoneNumberId) return block("vapi_live_configuration_required", 503);

  const claimed = await beginVoiceAttemptDispatch(attemptId);
  if (!claimed) return internalJson({ ok: false, error: "attempt_dispatch_already_claimed" }, 409);

  const outboundPayload = {
    assistantId,
    phoneNumberId,
    customer: { number: phoneNumber, name: context.candidateName, email: context.candidateEmail },
    metadata: { applicationId: context.applicationExternalId, attemptId, scheduledAt: context.attempt.scheduledAt, attemptNumber: context.attempt.attemptNumber, maxAttempts: context.attempt.maxAttempts },
    assistantOverrides: { variableValues: { candidate_name: context.candidateName, email: context.candidateEmail, selected_role: context.roleTitle || context.roleExternalId || "", application_id: context.applicationExternalId, attempt_id: attemptId, scheduled_at: context.attempt.scheduledAt } },
  };

  let response: Response;
  try {
    response = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(outboundPayload),
      cache: "no-store",
    });
  } catch (error) {
    await failVoiceAttemptDispatch(attemptId, error instanceof Error ? error.message : "Vapi request failed");
    return internalJson({ ok: false, error: "vapi_request_failed" }, 502);
  }

  const providerResponse = await response.json().catch(() => ({})) as Record<string, unknown>;
  const providerCallId = typeof providerResponse.id === "string" ? providerResponse.id.trim() : "";
  if (!response.ok || !providerCallId) {
    await failVoiceAttemptDispatch(attemptId, `Vapi returned HTTP ${response.status}.`);
    return internalJson({ ok: false, error: "vapi_dispatch_rejected" }, 502);
  }

  const attempt = await recordVoiceAttemptProviderCall({ attemptId, providerCallId });
  if (!attempt) return internalJson({ ok: false, error: "provider_call_already_recorded" }, 409);
  const log = await createVoiceCallLog({ applicationExternalId: context.applicationExternalId, voiceCallAttemptId: attemptId, provider: "vapi", providerCallId, sourceEventKey: `vapi-dispatch:${attemptId}`, callStatus: "initiated", rawResult: { provider: "vapi", callId: providerCallId } });
  return internalJson({ ok: true, dryRun: false, liveCallPlaced: true, providerCallId, attempt, log: { id: log.log?.id || null, created: log.created } });
});
