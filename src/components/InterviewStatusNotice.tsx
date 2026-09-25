"use client";

import { useEffect, useState } from "react";

type Props = { avatarToken: string; inProgress: boolean };

/**
 * Shown when the one-time link is reopened after the interview started. An
 * interview interrupted by a reload is saved immediately so nothing is lost;
 * the applicant never sees transcripts, analysis, or HR notes.
 */
export default function InterviewStatusNotice({ avatarToken, inProgress }: Props) {
  const [state, setState] = useState<"saving" | "saved" | "error">(inProgress ? "saving" : "saved");

  useEffect(() => {
    if (!inProgress) return;
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch("/api/live-avatar/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ avatarToken, interrupted: true }),
          });
          if (response.ok) { if (!cancelled) setState("saved"); return; }
        } catch {
          // retry below
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
      if (!cancelled) setState("error");
    })();
    return () => { cancelled = true; };
  }, [avatarToken, inProgress]);

  return <section className="card live-avatar-card" aria-live="polite">
    <div className="live-avatar-body">
      {state === "saving" && <p className="live-avatar-status">Your interview was interrupted. Saving what was recorded…</p>}
      {state === "saved" && <>
        <p><strong>{inProgress ? "Your interview was interrupted and has been saved." : "Your interview has been completed."}</strong></p>
        <p>This one-time interview link has already been used. The recruitment team will review your interview and contact you about the next steps.</p>
      </>}
      {state === "error" && <p>Your interview session is stored securely and will be passed to the recruitment team automatically. Please contact the recruitment team if you need help.</p>}
    </div>
  </section>;
}
