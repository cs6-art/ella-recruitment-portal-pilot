/**
 * Client-side signalling for the Ella Credits meter. Any component that
 * triggers a credit deduction (bulk resume upload, single CV analysis, voice
 * booking) fires this event so the global meter refreshes immediately instead
 * of waiting for its next poll. An optional `optimisticDelta` (negative for a
 * spend) lets the meter tick down instantly, then reconcile with the server.
 */

export const ELLA_CREDITS_REFRESH_EVENT = "ella-credits:refresh";

export type EllaCreditsRefreshDetail = { optimisticDelta?: number };

export function requestEllaCreditsRefresh(optimisticDelta?: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<EllaCreditsRefreshDetail>(ELLA_CREDITS_REFRESH_EVENT, {
      detail: { optimisticDelta },
    }),
  );
}
