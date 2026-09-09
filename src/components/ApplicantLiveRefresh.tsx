"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_MS = 5 * 60_000;
const EVENT_REFRESH_THROTTLE_MS = 30_000;

/** Keep server-rendered applicant status and booking details current. */
export default function ApplicantLiveRefresh({ enabled = true }: { enabled?: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    let lastRefreshAt = 0;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefreshAt < EVENT_REFRESH_THROTTLE_MS) return;
      lastRefreshAt = now;
      router.refresh();
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled, router]);

  return null;
}
