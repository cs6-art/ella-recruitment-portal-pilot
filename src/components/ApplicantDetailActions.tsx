"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { useConfirmation } from "@/components/ConfirmationModal";
import UiIcon from "@/components/UiIcon";
import { clientErrorMessage } from "@/lib/client-error";

export default function ApplicantDetailActions({ applicationId, candidateName, canManage = true }: { applicationId: string; candidateName: string; canManage?: boolean }) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function deleteRecord() {
    if (!(await confirm({ title: "Delete applicant record?", message: `Delete ${candidateName || "this applicant"}? This removes the applicant, screening evidence, history, and linked interview slots.`, confirmLabel: "Delete", tone: "danger" }))) return;
    setDeleting(true); setError("");
    try {
      const response = await fetch(`/api/applicants/${encodeURIComponent(applicationId)}`, { method: "DELETE", credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to delete the applicant.");
      router.push("/applicants");
      router.refresh();
    } catch (caught) {
      setError(clientErrorMessage(caught, "Unable to delete the applicant."));
      setDeleting(false);
    }
  }

  if (!canManage) return null;
  return <div className="applicant-record-actions"><Link className="btn btn-secondary" href={`/applicants/${encodeURIComponent(applicationId)}/edit`}><UiIcon name="edit" size={15} />Edit Applicant</Link><button className="btn btn-danger-outline" type="button" disabled={deleting} onClick={() => void deleteRecord()}><UiIcon name="trash" size={15} />{deleting ? "Deleting..." : "Delete Applicant"}</button>{error && <ActionFeedback kind="error" className="applicant-record-action-error">{error}</ActionFeedback>}</div>;
}
