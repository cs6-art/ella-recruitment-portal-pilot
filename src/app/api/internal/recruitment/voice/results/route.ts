import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { ingestVoiceResult, voiceResultStatuses } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResultBody = {
  applicationExternalId: string;
  attemptId?: string;
  score?: number | null;
  recommendation?: string;
  strengths?: string;
  concerns?: string;
  summary?: string;
  transcript?: string;
  callStatus?: string;
  callFinalStatus?: string;
  providerEventType?: string;
  providerEventId?: string;
  sourceEventKey?: string;
  callCompletedAt?: string;
  raw?: unknown;
  isComplete?: boolean;
  completenessScore?: number | null;
};

function isResultBody(value: unknown): value is ResultBody {
  return Boolean(value) && typeof value === "object" && typeof (value as ResultBody).applicationExternalId === "string";
}

// Vapi/n8n POST a completed voice interview result here (idempotent).
export const POST = withInternalAuth("voice_results", async (request) => {
  const body = await readInternalJson(request, isResultBody);
  if (!body) return internalJson({ ok: false, error: "applicationExternalId is required" }, 422);
  const result = await ingestVoiceResult(body);
  if (!result.applicationId) return internalJson({ ok: false, error: "unknown_application" }, 404);
  return internalJson({ ok: true, migrated: true, inserted: result.inserted, chargedCredits: result.chargedCredits || 0, billingOutcome: result.billingOutcome || null });
});

// Reconciliation poll: ?ids=APP-1,APP-2
export const GET = withInternalAuth("voice_results", async (request) => {
  const ids = (new URL(request.url).searchParams.get("ids") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 200);
  const statuses = await voiceResultStatuses(ids);
  return internalJson({ ok: true, migrated: true, statuses });
});
