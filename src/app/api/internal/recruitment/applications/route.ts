import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { createApplication, listApplications, updateApplicationProfile } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withInternalAuth("applications", async (request) => {
  const params = new URL(request.url).searchParams;
  const items = await listApplications(params.get("stage") || undefined, params.get("roleExternalId") || undefined);
  return internalJson({ ok: true, migrated: true, items: params.get("screened") === "true" ? items.filter((item) => Boolean(item.screeningResult)) : items });
});

export const POST = withInternalAuth("applications", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.externalId) && requiredString(item.applicantEmail) && requiredString(item.roleExternalId));
  });
  if (!body) return internalJson({ ok: false, error: "externalId_applicantEmail_roleExternalId_required" }, 422);
  const result = await createApplication({ externalId: String(body.externalId), applicantEmail: String(body.applicantEmail), roleExternalId: String(body.roleExternalId), applicantName: typeof body.applicantName === "string" ? body.applicantName : undefined, phone: typeof body.phone === "string" ? body.phone : undefined, preferredMobile: typeof body.preferredMobile === "string" ? body.preferredMobile : undefined, applicantCountry: typeof body.applicantCountry === "string" ? body.applicantCountry : undefined, source: typeof body.source === "string" ? body.source : undefined, sourceDetail: typeof body.sourceDetail === "string" ? body.sourceDetail : undefined, consentAt: typeof body.consentAt === "string" ? body.consentAt : undefined });
  if (result.error === "unknown_role") return internalJson({ ok: false, error: result.error }, 404);
  if (!result.application) return internalJson({ ok: false, error: "application_create_failed" }, 409);
  return internalJson({ ok: true, migrated: true, created: result.created, application: result.application }, result.created ? 201 : 200);
});

export const PATCH = withInternalAuth("applications", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.externalId));
  });
  if (!body) return internalJson({ ok: false, error: "externalId_required" }, 422);
  const result = await updateApplicationProfile({
    externalId: String(body.externalId), candidateName: typeof body.candidateName === "string" ? body.candidateName : undefined,
    phone: typeof body.phone === "string" ? body.phone : undefined, preferredMobile: typeof body.preferredMobile === "string" ? body.preferredMobile : undefined,
    applicantCountry: typeof body.applicantCountry === "string" ? body.applicantCountry : undefined, sourceDetail: typeof body.sourceDetail === "string" ? body.sourceDetail : undefined,
    actorEmail: typeof body.actorEmail === "string" ? body.actorEmail : undefined,
  });
  if (result.error) return internalJson({ ok: false, error: result.error }, 404);
  return internalJson({ ok: true, migrated: true, application: result.application });
});
