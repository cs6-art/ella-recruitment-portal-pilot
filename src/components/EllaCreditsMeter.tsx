"use client";

import { useEffect, useRef, useState } from "react";

import { ELLA_CREDITS_REFRESH_EVENT, type EllaCreditsRefreshDetail } from "@/lib/ella-credits-events";
import { useSharedPoll } from "@/lib/client-poll";
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

type MeterData = { balance: number; pricing: CreditPricing | null };

// The meter is ambient. Mutations that change the balance fire
// ELLA_CREDITS_REFRESH_EVENT (with an optimistic delta) and a short reconcile
// burst, so a slow background poll is enough to catch out-of-band changes
// (e.g. another user spending credits). Every mounted meter shares one poll.
const POLL_KEY = "ella-credits-balance";
const POLL_INTERVAL_MS = 90_000;
const RECONCILE_DELAYS_MS = [1200, 4000, 9000];

async function fetchMeterData(): Promise<MeterData | null> {
  const response = await fetch("/api/ella-credits/balance", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) return null;
  const data = await response.json();
  if (data?.success !== true || !Number.isFinite(Number(data.balance))) return null;
  const pricing = data.pricing && Number.isFinite(Number(data.pricing.cvAnalysis)) && Number.isFinite(Number(data.pricing.phoneInterview))
    ? { cvAnalysis: Number(data.pricing.cvAnalysis), phoneInterview: Number(data.pricing.phoneInterview) }
    : null;
  return { balance: Number(data.balance), pricing };
}

function formatCredits(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)));
}

export default function EllaCreditsMeter({ variant = "inline", collapsed = false }: EllaCreditsMeterProps) {
  const { data, refresh } = useSharedPoll<MeterData>(POLL_KEY, fetchMeterData, POLL_INTERVAL_MS);
  const [optimistic, setOptimistic] = useState(0);
  const [flash, setFlash] = useState(false);
  const reconcileTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastServerBalance = useRef<number | null>(null);

  // A fresh server value supersedes any optimistic adjustment, and flashes the
  // meter when the number actually moved.
  useEffect(() => {
    if (!data) return;
    const prev = lastServerBalance.current;
    lastServerBalance.current = data.balance;
    setOptimistic(0);
    if (prev !== null && prev !== data.balance) {
      setFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(false), 900);
    }
  }, [data]);

  useEffect(() => {
    const onRefresh = (event: Event) => {
      const detail = (event as CustomEvent<EllaCreditsRefreshDetail>).detail;
      const delta = Number(detail?.optimisticDelta);
      if (Number.isFinite(delta) && delta !== 0) setOptimistic((current) => current + delta);
      void refresh();
      reconcileTimers.current.forEach(clearTimeout);
      reconcileTimers.current = RECONCILE_DELAYS_MS.map((wait) => setTimeout(() => void refresh(), wait));
    };
    window.addEventListener(ELLA_CREDITS_REFRESH_EVENT, onRefresh);
    return () => {
      window.removeEventListener(ELLA_CREDITS_REFRESH_EVENT, onRefresh);
      reconcileTimers.current.forEach(clearTimeout);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [refresh]);

  const balance = data ? Math.max(0, data.balance + optimistic) : null;
  const pricing = data?.pricing ?? null;
  const shown = balance ?? 0;
  const tone = balance !== null && balance <= 0 ? styles.empty : balance !== null && balance < 50 ? styles.low : "";
  const variantClass = variant === "sidebar"
    ? `${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ""}`
    : variant === "mobile" ? styles.mobile : "";

  return (
    <div
      className={`${styles.meter} ${variantClass} ${tone} ${flash ? styles.changed : ""} ${balance === null ? styles.loading : ""}`}
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
