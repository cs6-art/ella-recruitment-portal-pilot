"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ELLA_CREDITS_REFRESH_EVENT, type EllaCreditsRefreshDetail } from "@/lib/ella-credits-events";
import styles from "./EllaCreditsMeter.module.css";

type Variant = "sidebar" | "mobile" | "inline";

type EllaCreditsMeterProps = {
  variant?: Variant;
  /** Sidebar only: hide the label/value when the rail is collapsed. */
  collapsed?: boolean;
};

type CreditPricing = {
  cvAnalysis: number;
  phoneInterview: number;
};

const POLL_INTERVAL_MS = 15_000;
// After a deduction is signalled, the server write may still be in flight and
// the Sheets cache mid-invalidation. Re-read a few times to settle on truth.
const RECONCILE_DELAYS_MS = [1200, 4000, 9000];

function formatCredits(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)));
}

export default function EllaCreditsMeter({ variant = "inline", collapsed = false }: EllaCreditsMeterProps) {
  const [balance, setBalance] = useState<number | null>(null);
  const [pricing, setPricing] = useState<CreditPricing | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const balanceRef = useRef<number | null>(null);
  const inFlight = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyBalance = useCallback((next: number) => {
    const changed = balanceRef.current !== null && balanceRef.current !== next;
    balanceRef.current = next;
    setBalance(next);
    if (changed) {
      setFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(false), 900);
    }
  }, []);

  const fetchBalance = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/ella-credits/balance", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) return;
      const data = await response.json();
      if (data?.success === true && Number.isFinite(Number(data.balance))) {
        applyBalance(Number(data.balance));
        if (data.pricing && Number.isFinite(Number(data.pricing.cvAnalysis)) && Number.isFinite(Number(data.pricing.phoneInterview))) {
          setPricing({ cvAnalysis: Number(data.pricing.cvAnalysis), phoneInterview: Number(data.pricing.phoneInterview) });
        }
      }
    } catch {
      // The meter is ambient; a transient failure just keeps the last value.
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [applyBalance]);

  const scheduleReconcile = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = RECONCILE_DELAYS_MS.map((delay) => setTimeout(() => void fetchBalance(), delay));
  }, [fetchBalance]);

  useEffect(() => {
    void fetchBalance();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void fetchBalance();
    }, POLL_INTERVAL_MS);

    const onVisible = () => { if (document.visibilityState === "visible") void fetchBalance(); };
    document.addEventListener("visibilitychange", onVisible);

    const onRefresh = (event: Event) => {
      const detail = (event as CustomEvent<EllaCreditsRefreshDetail>).detail;
      const delta = Number(detail?.optimisticDelta);
      if (Number.isFinite(delta) && delta !== 0 && balanceRef.current !== null) {
        applyBalance(Math.max(0, balanceRef.current + delta));
      }
      void fetchBalance();
      scheduleReconcile();
    };
    window.addEventListener(ELLA_CREDITS_REFRESH_EVENT, onRefresh);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(ELLA_CREDITS_REFRESH_EVENT, onRefresh);
      timers.current.forEach(clearTimeout);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [fetchBalance, scheduleReconcile, applyBalance]);

  const shown = balance ?? 0;
  const tone = balance !== null && balance <= 0 ? styles.empty : balance !== null && balance < 50 ? styles.low : "";
  const variantClass = variant === "sidebar"
    ? `${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ""}`
    : variant === "mobile" ? styles.mobile : "";

  return (
    <div
      className={`${styles.meter} ${variantClass} ${tone} ${flash ? styles.changed : ""} ${loading && balance === null ? styles.loading : ""}`}
      title={pricing ? `Credits — ${formatCredits(pricing.cvAnalysis)} per AI CV analysis, ${formatCredits(pricing.phoneInterview)} per AI phone interview` : "Credits"}
      aria-live="polite"
      aria-label={`Credits remaining: ${balance === null ? "loading" : formatCredits(shown)}`}
    >
      <span className={styles.icon} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2 3 7v10l9 5 9-5V7z" />
          <path d="M12 8v8M8.5 10l7 4M15.5 10l-7 4" />
        </svg>
      </span>
      {variant === "sidebar"
        ? <span className={styles.sidebarValueWrap}><span className={styles.value}>{balance === null ? "—" : formatCredits(shown)}</span><span className={styles.label}>credits</span></span>
        : <><span className={styles.value}>{balance === null ? "—" : formatCredits(shown)}</span><span className={styles.label}>Credits</span></>}
    </div>
  );
}
