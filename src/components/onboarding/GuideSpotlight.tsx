"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";

import UiIcon from "@/components/UiIcon";
import { GUIDE_EVENT, GUIDE_TIPS, isGuideTarget, type GuideDetail, type GuideTarget } from "@/lib/onboarding-events";
import styles from "./Onboarding.module.css";

const FIND_TIMEOUT_MS = 4_000;
const GAP = 12;
const FOCUSABLE = "button:not([disabled]), a[href], select:not([disabled]), input:not([disabled]):not([type='hidden']), textarea:not([disabled]), summary";

type Tip = { target: GuideTarget; text: string; top: number; left: number; arrowLeft: number; below: boolean };

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Spotlights one control on the page (`data-guide-target`) with a guided
 * border and a small tip placed beside it, never on top of it. Triggered by
 * `?guide=<target>` (links from the checklist and sidebar) or by `showGuide()`
 * (Smile's buttons). Dismissed with "Got it", Escape, using the control, or
 * leaving the page.
 */
export default function GuideSpotlight() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tip, setTip] = useState<Tip | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  const clear = useCallback(() => {
    elementRef.current?.removeAttribute("data-guide-active");
    elementRef.current = null;
    setTip(null);
  }, []);

  const position = useCallback((target: GuideTarget, text: string) => {
    const element = elementRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const height = tipRef.current?.offsetHeight || 120;
    const below = rect.bottom + GAP + height <= window.innerHeight || rect.top - GAP - height < 0;
    const top = below ? rect.bottom + GAP : rect.top - GAP - height;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const arrowLeft = Math.max(14, Math.min(width - 26, rect.left + Math.min(rect.width, 160) / 2 - left));
    setTip({ target, text, top, left, arrowLeft, below });
  }, []);

  const show = useCallback((target: GuideTarget, text?: string) => {
    clear();
    const message = text || GUIDE_TIPS[target];
    const started = Date.now();
    const attempt = () => {
      const element = Array.from(document.querySelectorAll<HTMLElement>(`[data-guide-target="${target}"]`)).find((node) => node.offsetParent !== null || node.getClientRects().length > 0);
      if (!element) {
        if (Date.now() - started < FIND_TIMEOUT_MS) window.setTimeout(attempt, 200);
        return;
      }
      elementRef.current = element;
      element.setAttribute("data-guide-active", "true");
      element.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      const focusable = element.matches(FOCUSABLE) ? element : element.querySelector<HTMLElement>(FOCUSABLE);
      focusable?.focus({ preventScroll: true });
      window.setTimeout(() => position(target, message), prefersReducedMotion() ? 0 : 420);
    };
    attempt();
  }, [clear, position]);

  // Links carry ?guide=<target>; show it once, then drop the parameter so a refresh doesn't repeat it.
  useEffect(() => {
    const requested = searchParams?.get("guide");
    if (!isGuideTarget(requested)) return;
    show(requested);
    const url = new URL(window.location.href);
    url.searchParams.delete("guide");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [searchParams, show]);

  useEffect(() => {
    const onGuide = (event: Event) => {
      const detail = (event as CustomEvent<GuideDetail>).detail;
      if (detail && isGuideTarget(detail.target)) show(detail.target, detail.text);
    };
    window.addEventListener(GUIDE_EVENT, onGuide);
    return () => window.removeEventListener(GUIDE_EVENT, onGuide);
  }, [show]);

  useEffect(() => clear, [pathname, clear]);

  // Follow the control while the page scrolls or resizes; close on Escape or when it is used.
  useEffect(() => {
    if (!tip) return;
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => position(tip.target, tip.text));
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") clear(); };
    const onPointer = (event: PointerEvent) => {
      if (elementRef.current && event.target instanceof Node && elementRef.current.contains(event.target)) window.setTimeout(clear, 150);
    };
    window.addEventListener("scroll", follow, { passive: true, capture: true });
    window.addEventListener("resize", follow);
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", follow, { capture: true });
      window.removeEventListener("resize", follow);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [tip, position, clear]);

  if (!tip || typeof document === "undefined") return null;
  return createPortal(
    <div ref={tipRef} className={`${styles.tooltip} ${tip.below ? styles.tooltipBelow : styles.tooltipAbove}`} style={{ top: tip.top, left: tip.left, ["--arrow-left" as string]: `${tip.arrowLeft}px` } as CSSProperties} role="status" aria-live="polite" data-smile-ignore>
      <strong><UiIcon name="sparkle" size={12} />Smile&apos;s tip</strong>
      <p>{tip.text}</p>
      <div className={styles.tooltipActions}><button type="button" onClick={clear}>Got it</button></div>
    </div>,
    document.body,
  );
}
