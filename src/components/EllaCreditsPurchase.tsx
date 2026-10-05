"use client";

import { useCallback, useEffect, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { requestEllaCreditsRefresh } from "@/lib/ella-credits-events";
import styles from "./EllaCreditsPurchase.module.css";

type CreditPack = {
  id: string;
  label: string;
  credits: number;
  amountCents: number;
  currency: string;
  bonusCredits?: number;
};

type Payment = {
  reference: string;
  status: string;
  credits: number;
  amountCents: number;
  currency: string;
  creditedAt?: string | null;
  newBalance?: number;
};

const nf = new Intl.NumberFormat("en-US");
const amountFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CURRENCY_SYMBOLS: Record<string, string> = { SGD: "S$", PHP: "₱" };
function formatMoney(amount: number, currency = "SGD") {
  return `${CURRENCY_SYMBOLS[currency] ?? `${currency} `}${amountFormat.format(amount)}`;
}
const CURRENCY_LABELS: Record<string, string> = { SGD: "SGD (PayNow, cards)", PHP: "PHP (QR Ph, cards)" };

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clearPaymentReturnUrl() {
  const url = new URL(window.location.href);
  ["payment", "ref", "status", "reference"].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export default function EllaCreditsPurchase() {
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [packsByCurrency, setPacksByCurrency] = useState<Record<string, CreditPack[]>>({});
  const [currencies, setCurrencies] = useState<string[]>(["SGD"]);
  const [currency, setCurrency] = useState("SGD");
  const [custom, setCustom] = useState<{ priceCents: number; prices?: Record<string, number>; min: number; max: number; bonusThreshold: number; bonusPercent: number }>({ priceCents: 40, min: 1, max: 10000, bonusThreshold: 0, bonusPercent: 0 });
  const [customCredits, setCustomCredits] = useState("");
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState("");
  const [error, setError] = useState("");
  const [returnReference, setReturnReference] = useState("");
  const [payment, setPayment] = useState<Payment | null>(null);
  const [returnMessage, setReturnMessage] = useState("");
  const [reconciling, setReconciling] = useState(false);

  const loadPacks = useCallback(async () => {
    try {
      const response = await fetch("/api/ella-credits/payments", { credentials: "same-origin", cache: "no-store" });
      const body = await response.json();
      if (!response.ok || body.success !== true) throw new Error(body.error || "Unable to load credit packs.");
      setPacks(body.packs || []);
      setPacksByCurrency(body.packsByCurrency || {});
      setCurrencies(Array.isArray(body.currencies) && body.currencies.length ? body.currencies : ["SGD"]);
      if (body.custom) setCustom(body.custom);
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
    if (params.get("payment") === "return") {
      const reference = params.get("ref") || "";
      setReturnReference(reference);
      if (reference) setReturnMessage("Verifying your payment and credit balance…");
    }
  }, [loadPacks]);

  useEffect(() => {
    if (!returnReference) return;
    let cancelled = false;

    async function readPaymentStatus() {
      const response = await fetch(`/api/ella-credits/payments/${encodeURIComponent(returnReference)}`, { credentials: "same-origin", cache: "no-store" });
      const body = await response.json();
      if (!response.ok || body.success !== true) throw new Error(body.error || "Unable to check payment status.");
      return body.payment as Payment;
    }

    async function reconcilePaymentStatus() {
      const response = await fetch(`/api/ella-credits/payments/${encodeURIComponent(returnReference)}`, { method: "POST", credentials: "same-origin", cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to reconcile payment.");
      if (body.payment) return body.payment as Payment;
      throw new Error(body.error || "Unable to reconcile payment.");
    }

    async function updatePayment(nextPayment: Payment) {
      if (cancelled) return false;
      setPayment(nextPayment);
      setError("");
      if (nextPayment.status === "paid" && nextPayment.creditedAt) {
        requestEllaCreditsRefresh();
        clearPaymentReturnUrl();
        setReturnReference("");
        setReturnMessage(`Payment Successful — ${nf.format(nextPayment.credits)} Smile Credits have been added. Amount paid: ${formatMoney(nextPayment.amountCents / 100, nextPayment.currency)}. New balance: ${nf.format(nextPayment.newBalance ?? 0)}.`);
        return true;
      }
      if (["failed", "expired", "cancelled", "refunded"].includes(nextPayment.status)) {
        setReturnMessage(`Payment ${nextPayment.status}. No credits were added.`);
        return true;
      }
      setReturnMessage(nextPayment.status === "paid"
        ? "Payment received. We’re finalizing your credit balance."
        : "Verifying your payment and credit balance…");
      return false;
    }

    async function poll() {
      for (let attempt = 0; attempt < 15 && !cancelled; attempt += 1) {
        try {
          let nextPayment = await readPaymentStatus();
          const terminal = await updatePayment(nextPayment);
          if (terminal) return;

          // The browser return is not proof of payment and the webhook can be
          // delayed or missed. Reconcile immediately, then at bounded
          // intervals, so a paid-but-uncredited record can self-heal without
          // hammering HitPay or creating duplicate credit grants.
          if (attempt === 0 || attempt % 5 === 0) {
            nextPayment = await reconcilePaymentStatus();
            if (await updatePayment(nextPayment)) return;
          }
        } catch (pollError) {
          if (!cancelled) setError(pollError instanceof Error ? pollError.message : "Unable to check payment status.");
        }
        await sleep(2000);
      }
      if (!cancelled) setReturnMessage("Payment confirmation is taking longer than expected. Check again to retry the verified provider status and credit update.");
    }

    void poll();
    return () => { cancelled = true; };
  }, [returnReference]);

  async function checkPaymentAgain() {
    if (!returnReference || reconciling) return;
    setReconciling(true);
    setError("");
    try {
      const response = await fetch(`/api/ella-credits/payments/${encodeURIComponent(returnReference)}`, { method: "POST", credentials: "same-origin", cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.payment) throw new Error(body.error || "Unable to reconcile payment.");
      const nextPayment = body.payment as Payment;
      setPayment(nextPayment);
      if (nextPayment.status === "paid" && nextPayment.creditedAt) {
        requestEllaCreditsRefresh();
        clearPaymentReturnUrl();
        setReturnReference("");
        setReturnMessage(`Payment confirmed. ${nf.format(nextPayment.credits)} credits have been added.`);
      } else if (["failed", "expired", "cancelled", "refunded"].includes(nextPayment.status)) {
        setReturnMessage(`Payment ${nextPayment.status}. No credits were added.`);
      } else {
        setReturnMessage("Payment is still being confirmed. We’ll keep the purchase safe and retry when you check again.");
      }
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : "Unable to reconcile payment.");
    } finally {
      setReconciling(false);
    }
  }

  async function startPayment(packId: string, credits?: number) {
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
        body: JSON.stringify(credits === undefined ? { packId, currency } : { credits, currency }),
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

  const visiblePacks = packsByCurrency[currency] ?? packs;
  const pricePerCredit = custom.prices?.[currency] ?? custom.priceCents;
  const customAmount = Number(customCredits);
  const customValid = customCredits.trim() !== "" && Number.isInteger(customAmount) && customAmount >= custom.min && customAmount <= custom.max;

  // Same rule the server applies when the payment settles (see volumeDiscountBonus).
  const bonusOn = custom.bonusThreshold > 0 && custom.bonusPercent > 0;
  const customBonus = customValid && bonusOn && customAmount >= custom.bonusThreshold ? Math.floor(customAmount * (custom.bonusPercent / 100)) : 0;

  return (
    <section className={`card ${styles.panel}`}>
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>CREDIT PURCHASE</span>
          <h2>Buy Smile Credits</h2>
          <p>Choose a pack or enter your own amount and continue to the secure checkout. Credits are added as soon as your payment is confirmed.</p>
        </div>
      </div>

      {error && <div className={styles.feedback}><ActionFeedback kind="error">{error}</ActionFeedback></div>}
      {returnMessage && <div className={styles.feedback}><ActionFeedback dismissAfterMs={payment?.status === "paid" && payment.creditedAt ? null : undefined} kind={payment?.status === "paid" && payment.creditedAt ? "success" : "warning"}>{returnMessage}</ActionFeedback>{returnReference && !(payment?.status === "paid" && payment.creditedAt) && !["failed", "expired"].includes(payment?.status || "") && <button type="button" className={`btn btn-secondary ${styles.retry}`} onClick={() => void checkPaymentAgain()} disabled={reconciling}>{reconciling ? "Checking payment…" : "Check payment again"}</button>}</div>}
      {payment && (returnReference || payment.status === "paid") && <p className={styles.reference}>Reference: <code>{payment.reference}</code> · Status: <strong>{payment.status}</strong>{payment.status === "paid" && payment.creditedAt ? <> · Balance: <strong>{nf.format(payment.newBalance ?? 0)}</strong></> : null}</p>}

      {!configured && !loading && <p className={styles.unavailable}>Credit purchases are currently unavailable. Please contact an administrator.</p>}
      {loading && <p className={styles.loading}>Loading credit packs…</p>}
      {configured && currencies.length > 1 && <div className={styles.feedback}>
        <label htmlFor="credit-currency">Pay in{" "}
          <select id="credit-currency" value={currency} disabled={buying !== ""} onChange={(event) => setCurrency(event.target.value)}>
            {currencies.map((code) => <option key={code} value={code}>{CURRENCY_LABELS[code] ?? code}</option>)}
          </select>
        </label>
      </div>}
      {configured && packs.length > 0 && <div className={styles.packGrid}>
        {visiblePacks.map((pack) => (
          <article className={styles.pack} key={pack.id}>
            <h3>{pack.label.split(" — ")[0]}</h3>
            <p className={styles.packCredits}>{nf.format(pack.credits)} credits</p>
            {(pack.bonusCredits ?? 0) > 0 && <p className={styles.packBonus}>+ {nf.format(pack.bonusCredits ?? 0)} bonus credits</p>}
            <p className={styles.packPrice}>{formatMoney(pack.amountCents / 100, pack.currency)}</p>
            <button type="button" className="btn btn-primary" disabled={buying !== ""} onClick={() => void startPayment(pack.id)}>
              {buying === pack.id ? "Opening checkout…" : "Pay with HitPay"}
            </button>
          </article>
        ))}
      </div>}
      {configured && packs.length > 0 && <div className={styles.customRow}>
        <div className={styles.customText}>
          <h3>Need a different amount?</h3>
          <p>Buy exactly the credits you need, from {nf.format(custom.min)} up to {nf.format(custom.max)}, at {formatMoney(pricePerCredit / 100, currency)} per credit.{bonusOn && <> Buy {nf.format(custom.bonusThreshold)} or more and get a <strong>{custom.bonusPercent}% bonus</strong> in free credits.</>}</p>
        </div>
        <div className={styles.customControls}>
          <label className={styles.customField} htmlFor="custom-credits">
            <span>Credits</span>
            <input
              id="custom-credits"
              type="number"
              inputMode="numeric"
              min={custom.min}
              max={custom.max}
              step={1}
              value={customCredits}
              onChange={(event) => setCustomCredits(event.target.value)}
              placeholder="e.g. 25"
            />
          </label>
          <p className={styles.customTotal}><span>Total</span><strong>{customValid ? formatMoney((customAmount * pricePerCredit) / 100, currency) : "—"}</strong>{customBonus > 0 && <em className={styles.customBonus}>+{nf.format(customBonus)} bonus credits</em>}</p>
          <button type="button" className="btn btn-primary" disabled={buying !== "" || !customValid} onClick={() => void startPayment("custom", customAmount)}>
            {buying === "custom" ? "Opening checkout…" : "Pay with HitPay"}
          </button>
        </div>
      </div>}
    </section>
  );
}
