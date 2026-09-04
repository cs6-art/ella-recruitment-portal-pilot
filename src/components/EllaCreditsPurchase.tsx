"use client";

import { useCallback, useEffect, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import styles from "./EllaCreditsPurchase.module.css";

type CreditPack = {
  id: string;
  label: string;
  credits: number;
  amountCents: number;
  currency: string;
};

type Payment = {
  reference: string;
  status: string;
  credits: number;
  amountCents: number;
  currency: string;
  creditedAt?: string | null;
};

const nf = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function EllaCreditsPurchase() {
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState("");
  const [error, setError] = useState("");
  const [returnReference, setReturnReference] = useState("");
  const [payment, setPayment] = useState<Payment | null>(null);
  const [returnMessage, setReturnMessage] = useState("");

  const loadPacks = useCallback(async () => {
    try {
      const response = await fetch("/api/ella-credits/payments", { credentials: "same-origin", cache: "no-store" });
      const body = await response.json();
      if (!response.ok || body.success !== true) throw new Error(body.error || "Unable to load credit packs.");
      setPacks(body.packs || []);
      setConfigured(body.configured === true);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load credit packs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPacks();
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "return") setReturnReference(params.get("ref") || "");
  }, [loadPacks]);

  useEffect(() => {
    if (!returnReference) return;
    let cancelled = false;

    async function poll() {
      for (let attempt = 0; attempt < 15 && !cancelled; attempt += 1) {
        try {
          const response = await fetch(`/api/ella-credits/payments/${encodeURIComponent(returnReference)}`, { credentials: "same-origin", cache: "no-store" });
          const body = await response.json();
          if (!response.ok || body.success !== true) throw new Error(body.error || "Unable to check payment status.");
          const nextPayment = body.payment as Payment;
          if (cancelled) return;
          setPayment(nextPayment);
          setError("");
          if (nextPayment.status === "paid" && nextPayment.creditedAt) {
            setReturnMessage(`Payment confirmed. ${nf.format(nextPayment.credits)} credits have been added.`);
            return;
          }
          if (["failed", "expired"].includes(nextPayment.status)) {
            setReturnMessage(`Payment ${nextPayment.status}. No credits were added.`);
            return;
          }
        } catch (pollError) {
          if (!cancelled) setError(pollError instanceof Error ? pollError.message : "Unable to check payment status.");
          return;
        }
        await sleep(2000);
      }
      if (!cancelled) setReturnMessage("Payment is still being confirmed. Your balance will update after the verified webhook is processed.");
    }

    void poll();
    return () => { cancelled = true; };
  }, [returnReference]);

  async function startPayment(packId: string) {
    setBuying(packId);
    setError("");
    try {
      const response = await fetch("/api/ella-credits/payments", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `credit-purchase-ui:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ packId }),
      });
      const body = await response.json();
      if (!response.ok || body.success !== true || typeof body.url !== "string" || !body.url) {
        throw new Error(body.error || "Unable to start the payment.");
      }
      window.location.assign(body.url);
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Unable to start the payment.");
      setBuying("");
    }
  }

  return (
    <section className={`card ${styles.panel}`}>
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>CREDIT PURCHASE</span>
          <h2>Buy Ella Credits</h2>
          <p>Choose a pack and continue to the secure HitPay checkout. Credits are added only after the verified payment webhook succeeds.</p>
        </div>
      </div>

      {error && <div className={styles.feedback}><ActionFeedback kind="error">{error}</ActionFeedback></div>}
      {returnMessage && <div className={styles.feedback}><ActionFeedback kind={payment?.status === "paid" ? "success" : "warning"}>{returnMessage}</ActionFeedback></div>}
      {payment && <p className={styles.reference}>Reference: <code>{payment.reference}</code> · Status: <strong>{payment.status}</strong></p>}

      {!configured && !loading && <p className={styles.unavailable}>Credit purchases are currently unavailable. Please contact an administrator.</p>}
      {loading && <p className={styles.loading}>Loading credit packs…</p>}
      {configured && packs.length > 0 && <div className={styles.packGrid}>
        {packs.map((pack) => (
          <article className={styles.pack} key={pack.id}>
            <h3>{pack.label}</h3>
            <p className={styles.packCredits}>{nf.format(pack.credits)} credits</p>
            <p className={styles.packPrice}>{money.format(pack.amountCents / 100)}</p>
            <button type="button" className="btn btn-primary" disabled={buying !== ""} onClick={() => void startPayment(pack.id)}>
              {buying === pack.id ? "Opening checkout…" : "Pay with HitPay"}
            </button>
          </article>
        ))}
      </div>}
    </section>
  );
}
