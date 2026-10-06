import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { canManagePipeline } from "@/lib/access-control";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { resolveRecruitmentRoleForNewWork } from "@/lib/recruitment-role-resolution";
import { ROLE_TARGET_DATE_PASSED_MESSAGE } from "@/lib/recruitment-role-eligibility";
import { retryFailedBulkQueueItems } from "@/lib/internal-recruitment-queries";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/safe-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  roleId: z.string().trim().min(1).max(200),
  queueIds: z.array(z.string().trim().min(1).max(500)).min(1).max(150),
});

function responseError(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

/** Re-queue saved failed work; no resume re-upload or duplicate application. */
export async function POST(request: Request) {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return responseError("Authentication required.", 401);
  if (!canManagePipeline(user)) return responseError("Only HR reviewers can retry bulk resumes.", 403);
  if (!isPostgresRecruitmentTarget()) return responseError("Saved queue retry is available in the active recruitment target only.", 409);

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return responseError("Choose at least one failed resume to retry.", 422);
  const { role, error: roleError } = await resolveRecruitmentRoleForNewWork(parsed.data.roleId, user.organizationId);
  if (!role) return responseError(roleError === "target_date_passed" ? ROLE_TARGET_DATE_PASSED_MESSAGE : "The selected role is not available for bulk screening.", 409);

  try {
    const retried = await retryFailedBulkQueueItems({
      roleExternalId: parsed.data.roleId,
      organizationId: user.organizationId,
      dedupeKeys: parsed.data.queueIds,
    });
    if (retried.length === 0) return responseError("No matching failed queue items were found. Refresh the status and try again.", 409);
    return NextResponse.json({ success: true, roleId: parsed.data.roleId, queueIds: retried.map((item) => item.dedupeKey), retried: retried.length });
  } catch (error) {
    console.error("[Bulk Resume Retry] POST failed:", error);
    return responseError(publicErrorMessage(error, "Unable to retry the failed resumes.", "API Bulk Retry"), 400);
  }
}
