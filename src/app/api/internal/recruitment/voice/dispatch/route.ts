import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { assertCreditsAvailable, EllaCreditsError } from "@/lib/ella-credits";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import {
  beginVoiceAttemptDispatch,
  blockVoiceAttempt,
  listApplicationSlots,
  voiceAttemptContext,
} from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePhone(value: unknown) {
  const normalized = String(value ?? "").trim().replace(/[\s().-]+/g, "");
  if (/^00[1-9]\d{7,14}$/.test(normalized)) return `+${normalized.slice(2)}`;
  return normalized;
}

function isDue(value: unknown) {
  return value instanceof Date && !Number.isNaN(value.valueOf()) && value.getTime() <= Date.now();
}

/**
 * Prepare one claimed attempt for the external n8n voice worker. Vercel owns
 * all pre-call validation and the database side-effect barrier; n8n owns the
 * Vapi credential and provider request.
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
    await assertCreditsAvailable(1, "phone_interview", { organizationId: context.organizationId, ownerEmail: context.creditOwnerEmail });
  } catch (error) {
    if (error instanceof EllaCreditsError) {
      await blockVoiceAttempt(attemptId, "insufficient_voice_credits").catch(() => undefined);
      return internalJson({ ok: false, error: "insufficient_voice_credits", required: error.required, available: error.available }, 402);
    }
    throw error;
  }

  const claimed = await beginVoiceAttemptDispatch(attemptId);
  if (!claimed) return internalJson({ ok: false, error: "attempt_dispatch_already_claimed" }, 409);
  return internalJson({
    ok: true,
    dispatchReady: true,
    attemptId,
    applicationExternalId: context.applicationExternalId,
    candidate: {
      name: context.candidateName,
      phoneNumber,
    },
    role: {
      externalId: context.roleExternalId || "",
      title: context.roleTitle || "",
    },
    applicantCountry: context.applicantCountry || "",
    scheduledAt: context.attempt.scheduledAt,
    attemptNumber: context.attempt.attemptNumber,
    maxAttempts: context.attempt.maxAttempts,
    status: "dispatching",
  });
});
