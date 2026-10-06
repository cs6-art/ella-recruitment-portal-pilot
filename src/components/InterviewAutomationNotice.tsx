"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Small "Auto-invite on" indicator for a role, so HR is never surprised that
 * applicants move to interview on their own. Renders nothing while off.
 */
export default function InterviewAutomationNotice({ roleId, variant = "chip" }: { roleId: string; variant?: "chip" | "upload" }) {
  const [minScore, setMinScore] = useState<number | null>(null);

  useEffect(() => {
    setMinScore(null);
    if (!roleId) return;
    let active = true;
    fetch(`/api/roles/${encodeURIComponent(roleId)}/interview-automation`, { credentials: "same-origin", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data?.success && data.automation?.enabled) setMinScore(Number(data.automation.minScore));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [roleId]);

  if (minScore === null) return null;
  const href = `/roles/${encodeURIComponent(roleId)}#interview-automation`;
  if (variant === "upload") {
    return <p className="interview-automation-upload-note" role="status">Interview automation is on: applicants scoring {minScore}% or more will be invited to interview automatically. <Link href={href}>Change</Link></p>;
  }
  return <Link className="interview-automation-chip" href={href} title="Open this role's Interview automation setting">Auto-invite on · {minScore}%+</Link>;
}
