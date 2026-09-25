"use client";

import { useRef, useState } from "react";

import { useConfirmation } from "@/components/ConfirmationModal";
import ValidationSummary from "@/components/ValidationSummary";
import { STATUS_ACTION_LABELS } from "@/lib/status-actions";
import { notificationPresentation } from "@/lib/notification-status";
import { formatPortalDateTime } from "@/lib/portal-time";

export type RoleStatusHistoryEntry = {
  timestamp: string;
  roleId: string;
  previousStatus: string;
  newStatus: string;
  action: string;
  performedByName: string;
  performedByEmail?: string;
  accessRole: string;
  department?: string;
  comments: string;
  resumeTargetStatus?: string;
  notificationStatus?: string;
  notificationError?: string;
  actionRequestId?: string;
};

type StatusApiResponse = {
  success?: boolean;
  roleId?: string;
  status?: string;
  action?: string;
  notificationStatus?: string;
  notificationError?: string;
  error?: string;
  code?: string;
  missingFields?: string[];
  workflowError?: string;
};

type HrReviewProps = {
  roleId: string;
  status: string;
  canReviewRole: boolean;
  canApproveRole: boolean;
  history: RoleStatusHistoryEntry[];
  onSuccess: (message: string, warning?: string, status?: string, roleId?: string) => void;
  onConflict?: () => void;
};

const actionLabels = STATUS_ACTION_LABELS;

function actionPrompt(action: string) {
  return `Confirm “${actionLabels[action]}”? This will update the role request status.`;
}

function formatDate(value: string) {
  return formatPortalDateTime(value, true);
}

function latestHold(history: RoleStatusHistoryEntry[]) {
  return history.find((entry) => entry.newStatus === "On Hold");
}

export default function HrReview({
  roleId,
  status,
  canApproveRole,
  history,
  onSuccess,
  onConflict,
}: HrReviewProps) {
  const [comments, setComments] = useState("");
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const { confirm } = useConfirmation();
  const submissionLock = useRef(false);
  const retryRequest = useRef<{ action: string; id: string } | null>(null);

  const hold = latestHold(history);

  // Requests that were returned or put on hold before those steps were retired
  // can be decided directly like any pending request.
  const decidable = ["Pending HR Discussion", "Returned for Revision", "On Hold"].includes(status);
  const actions = decidable && canApproveRole ? ["approve_role", "reject_role"] : [];

  async function submitAction(action: string) {
    if (submissionLock.current) return;

    const trimmedComments = comments.trim();
    if (action === "reject_role" && !trimmedComments) {
      setError("Tell the requester why this role request is being rejected.");
      return;
    }

    if (action === "reject_role" && !(await confirm({ title: actionLabels[action], message: actionPrompt(action), confirmLabel: actionLabels[action], tone: "danger" }))) return;

    submissionLock.current = true;
    setSubmittingAction(action);
    setError("");

    try {
      const actionRequestId = retryRequest.current?.action === action
        ? retryRequest.current.id
        : globalThis.crypto.randomUUID();
      retryRequest.current = { action, id: actionRequestId };
      const response = await fetch(
        `/api/roles/${encodeURIComponent(roleId)}/status`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            comments: trimmedComments,
            actionRequestId,
          }),
        },
      );

      // Read the body as text first. A proxy or an unavailable Next.js route can
      // return an HTML error page, which would otherwise surface the opaque
      // `Unexpected token '<'` JSON parsing error to the user.
      const rawResponse = await response.text();
      let data: StatusApiResponse = {};
      if (rawResponse.trim()) {
        try {
          data = JSON.parse(rawResponse) as StatusApiResponse;
        } catch {
          throw new Error(
            response.ok
              ? "The status update returned an invalid response."
              : `Unable to update the role status (HTTP ${response.status}).`,
          );
        }
      }

      if (!response.ok || data.success !== true) {
        if (response.status === 409 || data.code === "STATUS_CONFLICT") onConflict?.();
        const missingFields = Array.isArray(data.missingFields)
          ? data.missingFields.filter(Boolean).join(", ")
          : "";
        throw new Error(
          missingFields
            ? `${data.error || "Complete the requisition before approving this role."} Missing: ${missingFields}.`
            : [data.error || "Unable to update the role status.", data.workflowError]
                .filter(Boolean)
                .join(" "),
        );
      }

      const notificationStatus = data.notificationStatus || "not_configured";
      const { message: statusMessage, warning } = notificationPresentation(notificationStatus, data.notificationError);

      onSuccess(
        statusMessage,
        warning,
        data.status,
        data.roleId,
      );
      setComments("");
      retryRequest.current = null;
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to update the role status.",
      );
    } finally {
      submissionLock.current = false;
      setSubmittingAction(null);
    }
  }

  if (actions.length === 0 && status !== "On Hold") return null;

  return (
    <>
      {status === "On Hold" && hold && (
        <section className="card role-section">
          <div className="card-header">
            <h2>On hold details</h2>
          </div>
          <div className="section">
            <p className="status-context">
              Placed on hold by {hold.performedByName || "Not provided"} ({hold.accessRole || "Not provided"}) on {formatDate(hold.timestamp)}.
            </p>
            <p className="status-context">
              <strong>Latest comments:</strong> {hold.comments || "Not provided"}
            </p>
          </div>
        </section>
      )}

      {actions.length > 0 && (
        <section className="card role-section">
          <div className="card-header">
            <h2>Approve or reject this request</h2>
          </div>

          <div className="section">
            <div className="field">
              <label htmlFor="workflow-comments">Note <span className="field-optional">(optional when approving, required when rejecting)</span></label>
              <textarea
                id="workflow-comments"
                value={comments}
                maxLength={5000}
                disabled={submittingAction !== null}
                placeholder="Add a note for the requester and the status history."
                onChange={(event) => {
                  setComments(event.target.value);
                  setError("");
                }}
              />
              <small>Saved in Status History.</small>
            </div>
            {error && <ValidationSummary error={error} title="Status update failed" />}
          </div>

          <div className="form-actions">
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                className={action === "approve_role" ? "btn btn-primary" : "btn btn-danger-outline"}
                disabled={submittingAction !== null}
                onClick={() => void submitAction(action)}
              >
                {submittingAction === action ? "Submitting..." : actionLabels[action]}
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
