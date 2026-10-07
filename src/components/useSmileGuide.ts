"use client";

import { useEffect, useRef } from "react";

import { SMILE_SAY_EVENT, type SmileSayDetail } from "@/lib/smile-say";
import { tipFor, type TipContext, type TipEvent } from "@/lib/smile-tips";

export type GuideSay = { text: string; key: string; rect: DOMRect | null };

const NO_TIP_FOCUS_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset", "hidden", "file", "image"]);
const SAME_TIP_COOLDOWN_MS = 4_000;
const CLICK_TARGETS = "button, a[href], input, select, textarea, summary, label, [role='tab'], [role='switch'], [role='button']";

const collapse = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim().toLowerCase();

/** The visible extent of what the user touched, so Smile can stand next to it, not on it. */
function contentRect(element: Element): DOMRect {
  const host = element.matches("input[type='checkbox'], input[type='radio']") ? element.closest("label") || element : element;
  const own = host.getBoundingClientRect();
  // A label can stretch across its whole row: use what is actually inside it.
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  host.querySelectorAll("*").forEach((child) => {
    const box = child.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    left = Math.min(left, box.left); top = Math.min(top, box.top); right = Math.max(right, box.right); bottom = Math.max(bottom, box.bottom);
  });
  if (!Number.isFinite(left)) return own;
  return new DOMRect(Math.min(left, own.left), Math.min(top, own.top), Math.max(right, own.left) - Math.min(left, own.left), Math.max(bottom, own.top) - Math.min(top, own.top));
}

function describe(element: Element, event: TipEvent, path: string): TipContext {
  const input = element as HTMLInputElement;
  const tag = element.tagName.toLowerCase();
  const labelled = "labels" in input && input.labels && input.labels.length > 0 ? Array.from(input.labels).map((label) => label.textContent).join(" ") : element.closest("label")?.textContent;
  const text = collapse([labelled, element.getAttribute("aria-label"), tag === "button" || tag === "a" || tag === "summary" || element.getAttribute("role") ? element.textContent : "", element.getAttribute("placeholder"), element.getAttribute("title")].filter(Boolean).join(" | ")).slice(0, 200);
  const select = element as HTMLSelectElement;
  const value = tag === "select" ? select.selectedOptions[0]?.textContent?.trim() || select.value : input.value || "";
  return {
    event,
    path,
    tag,
    type: tag === "input" ? (input.type || "text").toLowerCase() : "",
    text,
    id: element.id || "",
    name: input.name || "",
    value,
    checked: tag === "input" ? input.checked : false,
    number: (element.closest("label")?.querySelector("input[type='number']") as HTMLInputElement | null)?.value || "",
    section: element.closest("section[id], [id^='interview-'], form[id]")?.id || "",
  };
}

/**
 * Watches the whole portal for clicks, ticks, selections and field focus, and
 * asks `onSay` to speak when there is a tip for the control (see smile-tips.ts).
 * Also relays `smileSay()` calls from components. Quiet while a dialog is open
 * or while `enabled` is false.
 */
export function useSmileGuide({ enabled, path, onSay }: { enabled: boolean; path: string; onSay: (say: GuideSay) => void }) {
  const sayRef = useRef(onSay);
  const pathRef = useRef(path);
  const seenFocus = useRef(new Set<string>());
  const last = useRef({ key: "", at: 0 });

  useEffect(() => { sayRef.current = onSay; }, [onSay]);
  useEffect(() => { pathRef.current = path; seenFocus.current = new Set(); }, [path]);

  useEffect(() => {
    if (!enabled) return;

    function handle(event: TipEvent, raw: EventTarget | null) {
      if (!(raw instanceof Element)) return;
      if (raw.closest("[data-smile-ignore], #smile-help-panel")) return;
      // A dialog sits above Smile: stay out of its way.
      if (document.querySelector("[role='dialog'], .confirmation-modal-backdrop, .booking-modal-backdrop, .user-account-modal-backdrop")) return;

      let element: Element | null = null;
      if (event === "click") {
        const found = raw.closest(CLICK_TARGETS);
        if (!found) return;
        if (found.tagName === "LABEL") {
          // Clicking a label clicks its control next: speak for the control only.
          if ((found as HTMLLabelElement).control && (found as HTMLLabelElement).control !== raw) return;
          return;
        }
        const tag = found.tagName.toLowerCase();
        const type = tag === "input" ? (found as HTMLInputElement).type : "";
        // Fields speak on focus and selects on change; clicks are for things you press or tick.
        if (tag === "select" || tag === "textarea" || (tag === "input" && !["checkbox", "radio", "button", "submit", "file"].includes(type))) return;
        element = found;
      } else if (event === "focus") {
        const tag = raw.tagName.toLowerCase();
        const type = tag === "input" ? (raw as HTMLInputElement).type : "";
        if (!(tag === "textarea" || tag === "select" || (tag === "input" && !NO_TIP_FOCUS_TYPES.has(type)))) return;
        element = raw;
      } else {
        if (raw.tagName.toLowerCase() !== "select") return;
        element = raw;
      }

      const tip = tipFor(describe(element, event, pathRef.current));
      if (!tip) return;
      const now = Date.now();
      if (event === "focus") {
        if (seenFocus.current.has(tip.key)) return;
        seenFocus.current.add(tip.key);
      }
      if (tip.key === last.current.key && now - last.current.at < SAME_TIP_COOLDOWN_MS) return;
      last.current = { key: tip.key, at: now };
      const rect = contentRect(element);
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      sayRef.current({ text: tip.text, key: tip.key, rect });
    }

    const onClick = (event: MouseEvent) => handle("click", event.target);
    const onFocus = (event: FocusEvent) => handle("focus", event.target);
    const onChange = (event: Event) => handle("change", event.target);
    const onSayEvent = (event: Event) => {
      const detail = (event as CustomEvent<SmileSayDetail>).detail;
      if (!detail?.text) return;
      sayRef.current({ text: detail.text, key: `say:${detail.text}`, rect: detail.target ? contentRect(detail.target) : null });
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("change", onChange, true);
    window.addEventListener(SMILE_SAY_EVENT, onSayEvent);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("change", onChange, true);
      window.removeEventListener(SMILE_SAY_EVENT, onSayEvent);
    };
  }, [enabled]);
}
