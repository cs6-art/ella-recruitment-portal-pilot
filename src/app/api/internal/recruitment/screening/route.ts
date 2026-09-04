import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { listScreening, upsertScreeningResult } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withInternalAuth("screening", async (request) => {
  return internalJson({ ok: true, migrated: true, items: await listScreening(new URL(request.url).searchParams.get("applicationExternalId") || undefined) });
});

export const POST = withInternalAuth("screening", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.applicationExternalId));
  });
  if (!body) return internalJson({ ok: false, error: "applicationExternalId_required" }, 422);
  const result = await upsertScreeningResult({ applicationExternalId: String(body.applicationExternalId), matchScore: typeof body.matchScore === "number" ? body.matchScore : null, recommendation: typeof body.recommendation === "string" ? body.recommendation : undefined, summary: typeof body.summary === "string" ? body.summary : undefined, strengths: typeof body.strengths === "string" ? body.strengths : undefined, gaps: typeof body.gaps === "string" ? body.gaps : undefined, interviewQuestions: typeof body.interviewQuestions === "string" ? body.interviewQuestions : undefined, evaluationScores: body.evaluationScores, screenedAt: typeof body.screenedAt === "string" ? body.screenedAt : undefined, raw: body.raw });
  if (result.error) return internalJson({ ok: false, error: result.error }, 404);
  return internalJson({ ok: true, migrated: true, result: result.result }, 200);
});
