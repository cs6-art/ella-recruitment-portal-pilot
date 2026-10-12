"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { stepDefinition, type OnboardingState, type OnboardingStepKey } from "@/lib/onboarding";
import { ONBOARDING_REFRESH_EVENT } from "@/lib/onboarding-events";
import { smileSay } from "@/lib/smile-say";

type OnboardingAction =
  | { action: "acknowledge_review"; applicationId: string }
  | { action: "record_sample_role"; roleId: string; sampleJobId: string }
  | { action: "dismiss_completion" };

type OnboardingContextValue = {
  state: OnboardingState | null;
  loaded: boolean;
  error: string;
  /** The step that completed most recently in this browser tab, for a brief success highlight. */
  justCompleted: OnboardingStepKey | null;
  /** True while the organization is in the guided journey (steps still open). */
  guidedActive: boolean;
  refresh: () => Promise<void>;
  post: (action: OnboardingAction) => Promise<{ ok: boolean; error: string }>;
};

const OnboardingContext = createContext<OnboardingContextValue>({
  state: null,
  loaded: false,
  error: "",
  justCompleted: null,
  guidedActive: false,
  refresh: async () => undefined,
  post: async () => ({ ok: false, error: "Setup progress is unavailable." }),
});

export function useOnboarding() {
  return useContext(OnboardingContext);
}

const WAITING_POLL_MS = 20_000;
const ACTIVE_POLL_MS = 60_000;
const JUST_COMPLETED_MS = 6_000;
const SAID_PREFIX = "smile-onboarding:said:";

function onceThisSession(key: string) {
  try {
    if (window.sessionStorage.getItem(SAID_PREFIX + key) === "1") return false;
    window.sessionStorage.setItem(SAID_PREFIX + key, "1");
  } catch { /* storage blocked: say it anyway */ }
  return true;
}

/** Whether the current page is where the step is done, so Smile introduces it here. */
export function pageMatchesStep(path: string, step: OnboardingStepKey) {
  switch (step) {
    case "create_role": return path === "/roles/new" || path === "/roles";
    case "publish_role": return path.startsWith("/roles");
    case "add_candidate": return path === "/resume-screening";
    case "screen_resume": return path.startsWith("/applicants");
    case "review_applicant": return path.startsWith("/applicants/");
  }
}

/**
 * Loads the organization's guided-setup state once for the whole portal shell
 * and keeps it fresh: on navigation, when the tab regains focus, after any
 * action that requests a refresh, and on a short poll while a screening
 * result is pending. Every onboarding view reads this one copy.
 */
export default function OnboardingProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [justCompleted, setJustCompleted] = useState<OnboardingStepKey | null>(null);
  const previousDone = useRef<Set<OnboardingStepKey> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const completedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback((next: OnboardingState) => {
    const done = new Set(next.steps.filter((step) => step.state === "done").map((step) => step.key));
    const before = previousDone.current;
    previousDone.current = done;
    setState(next);
    if (!before || next.mode !== "guided") return;
    const fresh = next.steps.find((step) => step.state === "done" && !before.has(step.key));
    if (!fresh) return;
    setJustCompleted(fresh.key);
    if (completedTimer.current) clearTimeout(completedTimer.current);
    completedTimer.current = setTimeout(() => setJustCompleted(null), JUST_COMPLETED_MS);
    const following = stepDefinition(next.currentStep);
    smileSay(following
      ? `Done: ${fresh.title.toLowerCase()}. Next up: ${following.title.toLowerCase()}.`
      : "That's everything. You're ready to recruit with Smile!");
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      try {
        const response = await fetch("/api/onboarding", { credentials: "same-origin", cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success !== true || !data.onboarding) throw new Error(data.error || "Setup progress is unavailable.");
        apply(data.onboarding as OnboardingState);
        setError("");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Setup progress is unavailable.");
      } finally {
        setLoaded(true);
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [apply]);

  const post = useCallback(async (action: OnboardingAction) => {
    try {
      const response = await fetch("/api/onboarding", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) return { ok: false, error: String(data.error || "We could not save setup progress.") };
      if (data.onboarding) apply(data.onboarding as OnboardingState);
      return { ok: true, error: "" };
    } catch {
      return { ok: false, error: "We could not save setup progress. Check your connection and try again." };
    }
  }, [apply]);

  const guidedActive = state?.mode === "guided" && state.status !== "completed";

  // Navigation: the guided journey re-checks on every page; others only once.
  useEffect(() => {
    if (!loaded || guidedActive) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    const onRefresh = () => void refresh();
    const onVisible = () => { if (document.visibilityState === "visible" && guidedActive) void refresh(); };
    window.addEventListener(ONBOARDING_REFRESH_EVENT, onRefresh);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(ONBOARDING_REFRESH_EVENT, onRefresh);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, guidedActive]);

  // Screening runs in the background: poll a little faster while it is pending.
  useEffect(() => {
    if (!guidedActive) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, state?.screeningPending ? WAITING_POLL_MS : ACTIVE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [guidedActive, state?.screeningPending, refresh]);

  // Smile introduces the current step once per session on the page where it happens.
  useEffect(() => {
    if (!state || !guidedActive || !state.currentStep) return;
    const step = stepDefinition(state.currentStep);
    if (!step) return;
    let text = "";
    let key = "";
    if (pathname === "/dashboard" && state.status === "not_started") {
      text = "Welcome to Smile! I'll help you set up your first recruitment workflow. Start with the checklist on your Dashboard.";
      key = "welcome";
    } else if (pageMatchesStep(pathname, step.key)) {
      text = state.canAct ? step.smileIntro : "Your team is setting up its first recruitment workflow. This step needs an HR user.";
      key = `${step.key}:${pathname.split("/")[1] || ""}`;
    }
    if (!text) return;
    const timer = window.setTimeout(() => { if (onceThisSession(key)) smileSay(text); }, 1_600);
    return () => window.clearTimeout(timer);
  }, [pathname, state, guidedActive]);

  useEffect(() => () => { if (completedTimer.current) clearTimeout(completedTimer.current); }, []);

  const value = useMemo<OnboardingContextValue>(() => ({ state, loaded, error, justCompleted, guidedActive, refresh, post }), [state, loaded, error, justCompleted, guidedActive, refresh, post]);
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}
