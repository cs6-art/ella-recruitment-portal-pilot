"use client";

import { useRef, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { smileSay } from "@/lib/smile-say";
import styles from "./PromoCodeRedeem.module.css";

/**
 * "Have a promo code?" on the Credits page. The server decides everything
 * (validity, the 210-credit amount, one redemption per organization); this
 * only sends the code and shows the friendly result.
 */
export default function PromoCodeRedeem({ onRedeemed }: { onRedeemed: (credits: number) => void | Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  // Guards against a double click before React re-renders the disabled button.
  const inFlight = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  async function redeem() {
    const value = code.trim();
    if (!value || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/ella-credits/promo-codes/redeem", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: value }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        const failure = typeof data.error === "string" && data.error ? data.error : "The promo code could not be applied. Please try again.";
        setFeedback({ kind: "error", text: failure });
        smileSay(failure, rootRef.current);
        return;
      }
      setFeedback({ kind: "success", text: String(data.message || "Promo code applied.") });
      smileSay(`Done! ${String(data.message || "Promo code applied.")}`, rootRef.current);
      setCode("");
      await onRedeemed(Number(data.credits) || 0);
    } catch {
      setFeedback({ kind: "error", text: "The promo code could not be applied. Please try again." });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <div className={styles.promo} ref={rootRef}>
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void redeem(); }}>
      <label htmlFor="smile-promo-code" className={styles.label}>Have a promo code?</label>
      <div className={styles.row}>
        <input
          id="smile-promo-code"
          className={styles.input}
          value={code}
          maxLength={60}
          autoComplete="off"
          spellCheck={false}
          placeholder="Enter promo code"
          disabled={busy}
          onChange={(event) => { setCode(event.target.value.toUpperCase()); setFeedback(null); }}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>{busy ? "Redeeming…" : "Redeem"}</button>
      </div>
      <small className={styles.help}>Credits are added to your organization&apos;s shared balance. Each organization can use a promotion once.</small>
    </form>
    {feedback && <div role={feedback.kind === "error" ? "alert" : "status"}><ActionFeedback kind={feedback.kind}>{feedback.text}</ActionFeedback></div>}
  </div>;
}
