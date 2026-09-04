import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { createScreeningInvitation } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withInternalAuth("screening_invitations", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.roleExternalId) && requiredString(item.tokenHash) && requiredString(item.email) && requiredString(item.createdBy));
  });
  if (!body) return internalJson({ ok: false, error: "role_token_email_createdBy_required" }, 422);
  const result = await createScreeningInvitation({ roleExternalId: String(body.roleExternalId), tokenHash: String(body.tokenHash), email: String(body.email), createdBy: String(body.createdBy), expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined });
  if (result.error) return internalJson({ ok: false, error: result.error }, 404);
  return internalJson({ ok: true, migrated: true, created: result.created, invitation: result.invitation }, result.created ? 201 : 200);
});
