import Image from "next/image";

export default function AvatarInterviewNotFound() {
  return (
    <main className="avatar-interview-page">
      <section className="avatar-interview-shell avatar-interview-unavailable">
        <div className="avatar-interview-brand"><span className="avatar-interview-mark"><Image src="/smile-recruitment-portal-logo.png" alt="" width={34} height={34} /></span><span><strong>Smile</strong><small>Recruitment Portal</small></span></div>
        <span className="avatar-interview-eyebrow">CANDIDATE INTERVIEW</span>
        <h1>This interview link is no longer available</h1>
        <p>This secure link may have already been used, expired, or been replaced. Please contact the McLink Group recruitment team if you need help.</p>
      </section>
    </main>
  );
}

