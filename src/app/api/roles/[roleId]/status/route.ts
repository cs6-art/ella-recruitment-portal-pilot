import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getRoleRequestById,
  getRoleRequests,
  getRoleStatusHistory,
  updateRoleRequestFields,
} from "@/lib/google-sheets";
import { generateRoleId } from "@/lib/role-id";
import { invalidateSheetsCache } from "@/lib/sheets-cache";
import {
  COOKIE_NAME,
  verifySessionToken,
} from "@/lib/session";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { getPortalConfigValue } from "@/lib/portal-config";
import { resolvePublicAppBaseUrl } from "@/lib/public-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Status transitions are handled by this dynamic API route.

const transitions = {
  submit_draft_for_hr: {
    source: ["Draft"],
    target: "Pending HR Discussion",
    permission: "create",
  },
  send_for_management_approval: {
    source: ["Pending HR Discussion"],
    target: "Pending Management Approval",
    permission: "review",
  },
  return_for_revision_hr: {
    source: ["Pending HR Discussion"],
    target: "Returned for Revision",
    permission: "review",
  },
  place_on_hold_hr: {
    source: ["Pending HR Discussion"],
    target: "On Hold",
    permission: "review",
  },
  approve_role: {
    source: ["Pending Management Approval"],
    target: "Approved",
    permission: "approve",
  },
  reject_role: {
    source: ["Pending Management Approval"],
    target: "Rejected",
    permission: "approve",
  },
  return_for_revision_management: {
    source: ["Pending Management Approval"],
    target: "Returned for Revision",
    permission: "approve",
  },
  place_on_hold_management: {
    source: ["Pending Management Approval"],
    target: "On Hold",
    permission: "approve",
  },
  resume_hr_review: {
    source: ["Returned for Revision", "On Hold"],
    target: "Pending HR Discussion",
    permission: "review",
  },
  resume_management_approval: {
    source: ["On Hold"],
    target: "Pending Management Approval",
    permission: "approve",
  },
} as const;

type Action = keyof typeof transitions;

type RouteContext = {
  params: Promise<{
    roleId: string;
  }>;
};

const statusRequestSchema = z.object({
  action: z.string().trim().min(1).max(100),
  comments: z.string().trim().min(1).max(5000),
  actionRequestId: z.string().trim().min(1).max(200),
});

function jsonError(
  error: string,
  status: number,
  extra: Record<string, unknown> = {},
) {
  return NextResponse.json(
    {
      success: false,
      error,
      ...extra,
    },
    { status },
  );
}

function validRoleId(value: string) {
  return (
    value.length > 0 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function validRequestId(value: string) {
  return (
    value.length > 0 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export async function POST(
  request: Request,
  context: RouteContext,
) {
  try {
    const cookieStore = await cookies();
    const user = verifySessionToken(
      cookieStore.get(COOKIE_NAME)?.value,
    );

    if (!user) {
      return jsonError("Authentication required.", 401);
    }

    const rate = consumeRateLimit(`role-status:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
    if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many status changes. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

    const { roleId: routeRoleId } =
      await context.params;
    let roleId: string;

    try {
      roleId = decodeURIComponent(routeRoleId).trim();
    } catch {
      return jsonError("A valid role ID is required.", 400);
    }

    if (!validRoleId(roleId)) {
      return jsonError("A valid role ID is required.", 400);
    }

    let body: z.infer<typeof statusRequestSchema>;
    try {
      body = statusRequestSchema.parse(await request.json());
    } catch {
      return jsonError("Invalid status action payload.", 400);
    }

    if (!(body.action in transitions)) {
      return jsonError("The requested role action is not supported.", 400);
    }

    const action = body.action as Action;

    const comments = body.comments;
    const actionRequestId = body.actionRequestId;

    const transition = transitions[action];
    const permitted = transition.permission === "review"
      ? user.canReviewRole === true
      : transition.permission === "approve"
        ? user.canApproveRole === true
        : user.canCreateRole === true;

    if (!permitted) {
      return jsonError("You do not have permission to perform this action.", 403);
    }

    // Status submission immediately follows the draft PATCH. Do not use the
    // process-local role cache here: the two requests may hit different
    // instances and the second instance may not know about the new draft yet.
    const role = await getRoleRequestById(roleId, { fresh: true });
    if (!role) {
      return jsonError("Role request not found.", 404);
    }

    // The "create" permission tier (e.g. submitting a draft for HR review) is
    // intentionally broad — HOD, HR, and every other requester-tier account
    // share it — but it must still be scoped to the role's own requester.
    // Without this, any account holding canCreateRole could act on someone
    // else's draft role in another department just by knowing its ID.
    if (
      transition.permission === "create" &&
      user.canReviewRole !== true &&
      role.requesterEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()
    ) {
      return jsonError("You do not have permission to perform this action.", 403);
    }

    if (action === "send_for_management_approval" || action === "submit_draft_for_hr") {
      const missingFields: string[] = [];
      if (!role.jobDescription?.trim()) missingFields.push("Job_Description");
      if (!role.jobTitle?.trim()) missingFields.push("Job_Title");
      if (!role.department?.trim()) missingFields.push("Department");
      if (!role.numberOfVacancies || role.numberOfVacancies < 1) missingFields.push("Number_Of_Vacancies");
      if (!role.reasonForRequest?.trim()) missingFields.push("Reason_For_Request");
      if (!role.targetHiringDate?.trim()) missingFields.push("Target_Hiring_Date");
      if (missingFields.length) return jsonError("Complete the requisition before requesting approval.", 409, { code: "REQUISITION_INCOMPLETE", missingFields });
    }

    // Autosaved drafts are identified by a client-generated DRAFT-<uuid> id
    // that was never meant to be permanent. The first time a draft leaves the
    // Draft status, rename it to the same readable, sequential Role_ID scheme
    // used for roles created directly (e.g. CSE02), so the "DRAFT-..." id
    // never surfaces once HR, management, or the public posting sees it.
    if (action === "submit_draft_for_hr" && role.roleId.startsWith("DRAFT-")) {
      try {
        const existingRoles = await getRoleRequests();
        const renamedRoleId = generateRoleId(role.jobTitle, existingRoles.map((existingRole) => existingRole.roleId));
        await updateRoleRequestFields(role.roleId, { Role_ID: renamedRoleId });
        invalidateSheetsCache("Role_Requests");
        role.roleId = renamedRoleId;
      } catch (renameError) {
        // Keep the DRAFT- id rather than block submission if the rename fails.
        console.error("[API Role Status] Could not rename draft role ID:", renameError);
      }
    }

    const history = await getRoleStatusHistory(role.roleId);
    const existing = history.find(
      (entry) => entry.actionRequestId === actionRequestId,
    );

    if (existing) {
      return NextResponse.json({
        success: true,
        roleId: role.roleId,
        previousStatus: existing.previousStatus,
        status: existing.newStatus,
        action: existing.action,
        notificationStatus: existing.notificationStatus || "unknown",
        idempotent: true,
        idempotentReplay: true,
        actionRequestId,
      });
    }

    if (!transition.source.some((source) => source === role.status)) {
      return jsonError(
        "The role status has changed since the page was loaded.",
        409,
        { code: "STATUS_CONFLICT", currentStatus: role.status },
      );
    }

    const latestHistory = history[0];
    if (
      action === "resume_hr_review" &&
      role.status === "On Hold" &&
      latestHistory?.resumeTargetStatus !==
        "Pending HR Discussion"
    ) {
      return jsonError(
        "This request is on hold for management approval.",
        409,
        { code: "STATUS_CONFLICT", currentStatus: role.status },
      );
    }

    if (
      action === "resume_management_approval" &&
      latestHistory?.resumeTargetStatus !==
        "Pending Management Approval"
    ) {
      return jsonError(
        "This request is on hold for HR review.",
        409,
        { code: "STATUS_CONFLICT", currentStatus: role.status },
      );
    }

    // Status transitions use the canonical role webhook. Prefer this over the
    // legacy request-only alias so a deployment cannot silently send status
    // events to a creation-only workflow.
    const webhookUrl = await getPortalConfigValue("N8N_Role_Webhook_URL");
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

    if (!webhookUrl || !webhookSecret) {
      return jsonError("The role status workflow is not configured.", 503);
    }

    const resumeTargetStatus =
      action === "place_on_hold_hr"
        ? "Pending HR Discussion"
        : action === "place_on_hold_management"
          ? "Pending Management Approval"
          : "";
    const timestamp = new Date().toISOString();
    const appBaseUrl = await resolvePublicAppBaseUrl(request);

    const payload = {
      eventType: "role_status_transition",
      event_type: "role_status_transition",
      roleId: role.roleId,
      action,
      actionRequestId,
      expectedCurrentStatus: role.status,
      newStatus: transition.target,
      comments,
      performedByName: user.name,
      performedByEmail: user.email.trim().toLowerCase(),
      performedByAccessRole: user.accessRole,
      performedByDepartment: user.department,
      timestamp,
      resumeTargetStatus,

      // Exact Role_Requests column aliases for the n8n update step.
      Role_ID: role.roleId,
      Status: transition.target,
      Last_Updated_At: timestamp,
      Last_Updated_By_Name: user.name,
      Last_Updated_By_Email: user.email.trim().toLowerCase(),
      Latest_Comments: comments,
      Resume_Target_Status: resumeTargetStatus,
      History_ID: actionRequestId,
      Changed_At: timestamp,
      Changed_By_Name: user.name,
      Changed_By_Email: user.email.trim().toLowerCase(),
      Previous_Status: role.status,
      New_Status: transition.target,
      Comments: comments,
      Action_Source: "Role Details Website",
      Action_Request_ID: actionRequestId,
      Action: action,
      Access_Role: user.accessRole,
      Department: user.department,
      portalUrl: appBaseUrl
        ? `${appBaseUrl}/roles/${encodeURIComponent(role.roleId)}`
        : "",
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": webhookSecret,
        "X-Idempotency-Key": actionRequestId,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const raw = await webhookResponse.text();
    let result: Record<string, unknown> = {};
    try {
      result = raw
        ? (JSON.parse(raw) as Record<string, unknown>)
        : {};
    } catch {
      result = {};
    }

    if (!webhookResponse.ok) {
      const workflowError =
        typeof result.error === "string"
          ? result.error
          : typeof result.message === "string"
            ? result.message
            : "";
      console.error(
        "[API Role Status] n8n rejected transition:",
        webhookResponse.status,
        result,
      );
      return jsonError(
        "The role status could not be updated.",
        webhookResponse.status === 409 ? 409 : 502,
        webhookResponse.status === 409
          ? {
          code: result.code || "STATUS_CONFLICT",
          currentStatus: result.currentStatus,
          workflowError,
        }
          : { workflowError },
      );
    }

    // The canonical role workflow may persist the transition and return an
    // empty 200 response when its response node has no body. Treat that as a
    // successful transition; reject only a non-empty response that explicitly
    // fails the workflow contract.
    if (raw.trim() !== "" && result.success !== true) {
      console.error("[API Role Status] Invalid n8n success response:", result);
      return jsonError("The role status workflow returned an invalid response.", 502);
    }

    // Keep the portal's source row synchronized even when the deployed n8n
    // workflow only records the transition in status history. This also
    // invalidates the short-lived read cache before the detail page refreshes.
    const persistedStatus = typeof result.status === "string" && result.status.trim()
      ? result.status
      : transition.target;
    try {
      await updateRoleRequestFields(role.roleId, {
        Status: persistedStatus,
        Last_Updated_At: timestamp,
        Last_Updated_By_Name: user.name,
        Last_Updated_By_Email: user.email.trim().toLowerCase(),
        Latest_Comments: comments,
        ...(action === "approve_role"
          ? {
              Management_Comments: comments,
              Approved_By: user.name,
              Approved_At: timestamp,
            }
          : {}),
      });
    } catch (persistenceError) {
      console.error("[API Role Status] Could not synchronize the Role_Requests row:", persistenceError);
    }
    // updateRoleRequestFields() invalidates on its own, but not when the
    // write above threw or matched no columns. n8n has still written the
    // transition, so drop the cached row unconditionally rather than letting
    // the detail page refresh into the previous status.
    invalidateSheetsCache("Role_Requests");
    invalidateSheetsCache("Role_Status_History");

    return NextResponse.json({
      success: true,
      roleId: role.roleId,
      previousStatus: role.status,
      status: persistedStatus,
      action,
      notificationStatus:
        typeof result.notificationStatus === "string"
          ? result.notificationStatus
          : "unknown",
      notificationError:
        typeof result.notificationError === "string"
          ? result.notificationError
          : "",
      actionRequestId,
      idempotentReplay: result.idempotentReplay === true,
    });
  } catch (error) {
    console.error("[API Role Status] POST failed:", error);
    return jsonError("Unable to update the role status.", 500);
  }
}
