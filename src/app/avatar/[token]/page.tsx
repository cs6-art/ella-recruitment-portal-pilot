import { notFound } from "next/navigation";

import LiveAvatarInterview from "@/components/LiveAvatarInterview";
import { getAvatarInterviewContext } from "@/lib/internal-recruitment-queries";
import { isLiveAvatarConfigured } from "@/lib/live-avatar";

export const dynamic = "force-dynamic";

export default async function AvatarInterviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await getAvatarInterviewContext(token);
  if (!context || !isLiveAvatarConfigured()) notFound();

  const preparation = {
    resumeSummary: context.resumeSummary,
    screeningQuestion: context.screeningQuestion,
  };

  return (
    <main className="avatar-interview-page">
      <section className="avatar-interview-shell">
        <div className="avatar-interview-brand"><span className="avatar-interview-mark">M</span><span><strong>McLink</strong><small>Recruitment Portal</small></span></div>
        <span className="avatar-interview-eyebrow">CANDIDATE INTERVIEW</span>
        <h1>Interview with Ella</h1>
        <p className="avatar-interview-intro">Hello {context.candidateName || "there"}. Ella will ask one focused question about your application for the <strong>{context.roleTitle}</strong> role.</p>
        <div className="avatar-interview-notice"><strong>This secure link can be used once.</strong><span>It expires automatically{context.expiresAt ? ` on ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" }).format(new Date(context.expiresAt))} (Singapore time)` : ""}.</span></div>
        <LiveAvatarInterview roleId={context.roleId} roleTitle={context.roleTitle} candidateName={context.candidateName} preparation={preparation} accessToken={token} />
        <p className="avatar-interview-disclosure">Ella is an AI interviewer. Your response may be recorded, transcribed, and reviewed by the McLink Group recruitment team. This is not an automated hiring decision.</p>
      </section>
    </main>
  );
}

