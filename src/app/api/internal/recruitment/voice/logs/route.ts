import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { createVoiceCallLog } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withInternalAuth("voice_logs", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.applicationExternalId) && requiredString(item.sourceEventKey));
  });
  if (!body) return internalJson({ ok: false, error: "applicationExternalId_and_sourceEventKey_required" }, 422);
  const result = await createVoiceCallLog({ applicationExternalId: String(body.applicationExternalId), voiceCallAttemptId: typeof body.voiceCallAttemptId === "string" ? body.voiceCallAttemptId : undefined, provider: typeof body.provider === "string" ? body.provider : undefined, providerCallId: typeof body.providerCallId === "string" ? body.providerCallId : undefined, providerEventId: typeof body.providerEventId === "string" ? body.providerEventId : undefined, sourceEventKey: String(body.sourceEventKey), callStatus: typeof body.callStatus === "string" ? body.callStatus : undefined, durationSeconds: typeof body.durationSeconds === "number" ? body.durationSeconds : null, recordingUrl: typeof body.recordingUrl === "string" ? body.recordingUrl : undefined, communicationScore: typeof body.communicationScore === "number" ? body.communicationScore : null, completenessScore: typeof body.completenessScore === "number" ? body.completenessScore : null, transcript: typeof body.transcript === "string" ? body.transcript : undefined, summary: typeof body.summary === "string" ? body.summary : undefined, recommendation: typeof body.recommendation === "string" ? body.recommendation : undefined, errorDetails: typeof body.errorDetails === "string" ? body.errorDetails : undefined, rawResult: body.rawResult, startedAt: typeof body.startedAt === "string" ? body.startedAt : undefined, endedAt: typeof body.endedAt === "string" ? body.endedAt : undefined });
  if (result.error) return internalJson({ ok: false, error: result.error }, 404);
  return internalJson({ ok: true, migrated: true, created: result.created, log: result.log });
});
