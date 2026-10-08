"use client";

import { useEffect, useRef } from "react";

import FeedbackForm from "./FeedbackForm";
import UiIcon from "./UiIcon";
import styles from "./SignOutFeedbackModal.module.css";

type SignOutFeedbackModalProps = {
  /** Complete the sign-out (feedback saved or skipped). */
  onSignOut: () => void;
  /** Close the prompt and stay signed in. */
  onClose: () => void;
};

/**
 * Shown when someone selects Sign Out. Feedback is always optional: Skip &
 * Sign Out works at any time, and a failed save never blocks signing out.
 */
export default function SignOutFeedbackModal({ onSignOut, onClose }: SignOutFeedbackModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="confirmation-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="signout-feedback-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <div>
            <h2 id="signout-feedback-title">Before you sign out</h2>
            <p>We’d love to hear how it went. This takes about a minute and is completely optional.</p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close and stay signed in"><UiIcon name="close" size={18} /></button>
        </header>
        <div className={styles.body}>
          <FeedbackForm
            source="sign_out"
            submitLabel="Submit Feedback & Sign Out"
            secondaryLabel="Skip & Sign Out"
            onSecondary={onSignOut}
            onSubmitted={onSignOut}
            failureMessage="We couldn’t save your feedback, but you can still sign out."
          />
        </div>
      </section>
    </div>
  );
}
