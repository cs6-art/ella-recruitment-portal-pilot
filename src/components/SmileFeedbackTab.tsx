"use client";

import { useState } from "react";

import FeedbackForm from "./FeedbackForm";
import styles from "./HelpBot.module.css";

/** Smile Bot's Feedback tab: the same survey as the sign-out prompt. */
export default function SmileFeedbackTab() {
  // Changing the key gives a fresh, empty form for "Send more feedback".
  const [round, setRound] = useState(0);
  const [sent, setSent] = useState(false);

  if (sent) {
    return <div className={styles.feedbackThanks} role="status">
      <strong>Thank you for your feedback!</strong>
      <p>It helps us make the portal easier to use.</p>
      <button type="button" className={styles.secondaryButton} onClick={() => { setSent(false); setRound((current) => current + 1); }}>Send more feedback</button>
    </div>;
  }

  return <div className={styles.feedbackTab}>
    <FeedbackForm
      key={round}
      source="smile_bot"
      intro="Tell us how the portal is working for you. It only takes a minute."
      submitLabel="Send feedback"
      onSubmitted={() => setSent(true)}
    />
  </div>;
}
