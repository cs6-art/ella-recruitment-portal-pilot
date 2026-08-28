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
  history: RoleStatusHistoryEntry[];
  onSuccess: (message: string, warning?: string, status?: string) => void;
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
  canReviewRole,
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

  // The Management-approval step was removed: an HR reviewer approves or
  // rejects directly from HR discussion, and every hold/return resumes to HR
  // discussion.
  const actions =
    status === "Pending HR Discussion" && canReviewRole
      ? [
          "approve_role",
          "reject_role",
          "return_for_revision_hr",
          "place_on_hold_hr",
        ]
      : (status === "Returned for Revision" || status === "On Hold") && canReviewRole
        ? ["resume_hr_review"]
        : [];

  async function submitAction(action: string) {
    if (submissionLock.current) return;

    const trimmedComments = comments.trim();
    if (!trimmedComments) {
      setError("Comments are required for every status change.");
      return;
    }

    if (!(await confirm({ title: actionLabels[action] || "Confirm status change", message: actionPrompt(action), confirmLabel: actionLabels[action] || "Confirm" }))) return;

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
            <h2>{status === "Pending HR Discussion" ? "HR Review" : "Workflow Action"}</h2>
          </div>

          <div className="section">
            <div className="field">
              <label htmlFor="workflow-comments">Comments</label>
              <textarea
                id="workflow-comments"
                value={comments}
                maxLength={5000}
                disabled={submittingAction !== null}
                placeholder="Required comments for this status change."
                onChange={(event) => {
                  setComments(event.target.value);
                  setError("");
                }}
              />
              <small>Required and saved in Status History.</small>
            </div>
            {error && <ValidationSummary error={error} title="Status update failed" />}
          </div>

          <div className="form-actions">
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                className={action === "approve_role" || action.includes("resume") ? "btn btn-primary" : "btn btn-secondary"}
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
