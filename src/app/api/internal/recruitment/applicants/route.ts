import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { listApplicants, upsertApplicant } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withInternalAuth("applicants", async (request) => {
  return internalJson({ ok: true, migrated: true, items: await listApplicants(new URL(request.url).searchParams.get("email") || undefined) });
});

export const POST = withInternalAuth("applicants", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.email));
  });
  if (!body) return internalJson({ ok: false, error: "email_required" }, 422);
  const applicant = await upsertApplicant({ email: String(body.email), fullName: typeof body.fullName === "string" ? body.fullName : undefined, phoneE164: typeof body.phoneE164 === "string" ? body.phoneE164 : undefined, country: typeof body.country === "string" ? body.country : undefined, notes: typeof body.notes === "string" ? body.notes : undefined });
  return internalJson({ ok: true, migrated: true, applicant }, 201);
});
