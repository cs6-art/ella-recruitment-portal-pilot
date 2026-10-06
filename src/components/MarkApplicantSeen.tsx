"use client";

import { useEffect } from "react";

import { refreshSharedPoll } from "@/lib/client-poll";

// Same key as the shared new-applicant feed in NewApplicantsBell.
const APPLICANT_FEED_POLL_KEY = "applicants-recent";

/**
 * Records that the signed-in user opened this applicant, so it stops being
 * NEW for them (bell, sidebar badge and list highlight) and for no one else.
 * Runs after the page renders, so link prefetching never marks anything seen.
 */
export default function MarkApplicantSeen({ applicationId }: { applicationId: string }) {
  useEffect(() => {
    if (!applicationId) return;
    const controller = new AbortController();
    fetch(`/api/applicants/${encodeURIComponent(applicationId)}/seen`, { method: "POST", credentials: "same-origin", signal: controller.signal })
      .then((response) => { if (response.ok) refreshSharedPoll(APPLICANT_FEED_POLL_KEY); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [applicationId]);
  return null;
}
