import Link from "next/link";
import Image from "next/image";

export default function BookingLinkNotFound() {
  return (
    <main className="booking-page">
      <section className="booking-card booking-unavailable-card" aria-labelledby="booking-unavailable-title">
        <div className="booking-brand">
          <span className="booking-brand-mark"><Image src="/smile-recruitment-portal-logo.png" alt="" width={34} height={34} /></span>
          <span>
            <strong>Smile</strong>
            <small>Recruitment Portal</small>
          </span>
        </div>

        <div className="booking-eyebrow">INTERVIEW BOOKING</div>
        <div className="booking-unavailable-icon" aria-hidden="true">!</div>
        <h1 id="booking-unavailable-title">This booking link is no longer available</h1>
        <p className="booking-intro">
          This interview link may have already been used, expired, or been replaced by a newer invitation.
        </p>

        <div className="booking-unavailable-notice">
          <strong>What should you do?</strong>
          <p>Open the latest booking link from your interview invitation. If you still need help, reply to that email and ask the recruitment team for a new link.</p>
        </div>

        <Link className="booking-submit booking-unavailable-link" href="/">
          Return to Smile
        </Link>
        <p className="booking-help">No action is required on this page.</p>
      </section>
    </main>
  );
}
