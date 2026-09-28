"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import UiIcon from "@/components/UiIcon";

type FeedbackKind = "success" | "error" | "warning";

type ActionFeedbackProps = {
  kind: FeedbackKind;
  children: ReactNode;
  className?: string;
  dismissAfterMs?: number | null;
  title?: string;
  ariaLive?: "off" | "polite" | "assertive";
};

const defaultDismissAfter: Record<FeedbackKind, number | null> = {
  success: 5000,
  warning: 7000,
  error: null,
};

export default function ActionFeedback({ kind, children, className = "", dismissAfterMs, title, ariaLive }: ActionFeedbackProps) {
  const feedbackRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const role = kind === "error" ? "alert" : "status";

  useEffect(() => {
    setVisible(true);
    const frame = window.requestAnimationFrame(() => {
      feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      feedbackRef.current?.focus({ preventScroll: true });
    });
    const timeout = dismissAfterMs ?? defaultDismissAfter[kind];
    const timer = timeout === null ? undefined : window.setTimeout(() => setVisible(false), timeout);
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [children, dismissAfterMs, kind]);

  if (!visible) return null;

  return <div ref={feedbackRef} className={`${kind}-box action-feedback ${kind === "error" ? "message-box" : ""} ${className}`.trim()} role={role} aria-live={ariaLive ?? (kind === "error" ? "assertive" : "polite")} tabIndex={-1}>
    {kind === "error" ? <>
      <span className="message-box-icon" aria-hidden="true"><UiIcon name="alert" size={17} /></span>
      <div className="message-box-body"><strong className="message-box-title">{title || "Something needs your attention"}</strong><div className="message-box-text">{children}</div></div>
    </> : <div className="action-feedback-content">{children}</div>}
    <button className="action-feedback-dismiss" type="button" aria-label="Dismiss notification" onClick={() => setVisible(false)}>×</button>
  </div>;
}
