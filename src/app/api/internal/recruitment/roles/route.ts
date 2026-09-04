import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { normalizeRequestType, record, requiredString } from "@/lib/internal-recruitment-http";
import { createRole, getRole, listRoles, updateRoleDetails } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withInternalAuth("roles", async (request) => {
  const params = new URL(request.url).searchParams;
  const externalId = params.get("externalId")?.trim();
  if (externalId) {
    const role = await getRole(externalId);
    if (!role) return internalJson({ ok: false, error: "unknown_role" }, 404);
    return internalJson({ ok: true, migrated: true, role });
  }
  return internalJson({ ok: true, migrated: true, items: await listRoles(params.get("status") || undefined) });
});

export const POST = withInternalAuth("roles", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.externalId) && requiredString(item.title));
  });
  if (!body) return internalJson({ ok: false, error: "externalId_and_title_required" }, 422);
  const requestType = normalizeRequestType(body.requestType);
  if (requestType === null) return internalJson({ ok: false, error: "invalid_request_type" }, 422);
  const result = await createRole({
    externalId: String(body.externalId), title: String(body.title), code: typeof body.code === "string" ? body.code : undefined,
    departmentSnapshot: typeof body.departmentSnapshot === "string" ? body.departmentSnapshot : undefined, requestType,
    vacancies: typeof body.vacancies === "number" ? body.vacancies : undefined, reason: typeof body.reason === "string" ? body.reason : undefined,
    targetHiringDate: typeof body.targetHiringDate === "string" ? body.targetHiringDate : undefined, status: typeof body.status === "string" ? body.status : undefined,
    source: typeof body.source === "string" ? body.source : undefined, requesterEmail: typeof body.requesterEmail === "string" ? body.requesterEmail : undefined,
    requesterName: typeof body.requesterName === "string" ? body.requesterName : undefined, actionRequestId: typeof body.actionRequestId === "string" ? body.actionRequestId : undefined,
    actorEmail: typeof body.actorEmail === "string" ? body.actorEmail : undefined, actorName: typeof body.actorName === "string" ? body.actorName : undefined,
  });
  if (!result.role) return internalJson({ ok: false, error: "role_create_failed" }, 409);
  return internalJson({ ok: true, migrated: true, created: result.created, role: result.role }, result.created ? 201 : 200);
});

export const PATCH = withInternalAuth("roles", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.externalId) && requiredString(item.actorEmail));
  });
  if (!body) return internalJson({ ok: false, error: "externalId_and_actorEmail_required" }, 422);
  const result = await updateRoleDetails({
    externalId: String(body.externalId), actorEmail: String(body.actorEmail),
    title: typeof body.title === "string" ? body.title : undefined, code: body.code === null || typeof body.code === "string" ? body.code : undefined,
    departmentSnapshot: typeof body.departmentSnapshot === "string" ? body.departmentSnapshot : undefined, requestType: typeof body.requestType === "string" ? body.requestType : undefined,
    vacancies: typeof body.vacancies === "number" ? body.vacancies : undefined, reason: typeof body.reason === "string" ? body.reason : undefined,
    targetHiringDate: body.targetHiringDate === null || typeof body.targetHiringDate === "string" ? body.targetHiringDate : undefined,
    recruitmentSetupStatus: typeof body.recruitmentSetupStatus === "string" ? body.recruitmentSetupStatus : undefined,
    setup: body.setup, evaluationFields: body.evaluationFields, availabilityRules: body.availabilityRules,
  });
  if (!result) return internalJson({ ok: false, error: "unknown_role" }, 404);
  return internalJson({ ok: true, migrated: true, role: result });
});
