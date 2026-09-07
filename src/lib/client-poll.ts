"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A process-wide shared poller. Many mounted components that need the same
 * server value (e.g. the credits meter in the sidebar AND the mobile header)
 * subscribe to ONE store here, so the app issues a single request per interval
 * instead of one per mounted component.
 *
 * Guarantees:
 *  - exactly one in-flight request at a time per key (later calls join it);
 *  - the interval only fires while the document is visible AND at least one
 *    component is subscribed;
 *  - an immediate refresh on tab re-focus, throttled so alt-tabbing cannot spam;
 *  - `refresh()` is available for event-driven updates after a mutation.
 */

type Store<T> = {
  getSnapshot: () => T | null;
  subscribe: (listener: () => void) => () => void;
  refresh: (options?: { throttleMs?: number }) => Promise<void>;
};

const registry = new Map<string, Store<unknown>>();

function createStore<T>(key: string, fetcher: () => Promise<T | null>, intervalMs: number): Store<T> {
  let value: T | null = null;
  const listeners = new Set<() => void>();
  let inFlight: Promise<void> | null = null;
  let lastFetch = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let onVisibility: (() => void) | null = null;
  let onFocus: (() => void) | null = null;

  const emit = () => listeners.forEach((l) => l());

  const doFetch = (): Promise<void> => {
    if (inFlight) return inFlight;
    lastFetch = Date.now();
    inFlight = (async () => {
      try {
        const next = await fetcher();
        if (next !== null && next !== undefined) {
          value = next;
          emit();
        }
      } catch {
        // Ambient data — keep the last known value on a transient failure.
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const refresh: Store<T>["refresh"] = (options) => {
    const throttleMs = options?.throttleMs ?? 0;
    if (throttleMs > 0 && Date.now() - lastFetch < throttleMs) return Promise.resolve();
    return doFetch();
  };

  const startTimers = () => {
    if (typeof window === "undefined" || timer) return;
    timer = setInterval(() => {
      if (document.visibilityState === "visible") void doFetch();
    }, intervalMs);
    onVisibility = () => { if (document.visibilityState === "visible") void refresh({ throttleMs: Math.min(intervalMs, 10_000) }); };
    onFocus = onVisibility;
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
  };

  const stopTimers = () => {
    if (timer) { clearInterval(timer); timer = null; }
    if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
    if (onFocus) window.removeEventListener("focus", onFocus);
    onVisibility = null;
    onFocus = null;
  };

  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        startTimers();
        void doFetch();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopTimers();
      };
    },
    refresh,
  };
}

function getStore<T>(key: string, fetcher: () => Promise<T | null>, intervalMs: number): Store<T> {
  let store = registry.get(key) as Store<T> | undefined;
  if (!store) {
    store = createStore(key, fetcher, intervalMs);
    registry.set(key, store as Store<unknown>);
  }
  return store;
}

/**
 * Subscribe a component to a shared poll. The `fetcher` / `intervalMs` from the
 * first caller for a given `key` win; keep them stable (module scope).
 */
export function useSharedPoll<T>(key: string, fetcher: () => Promise<T | null>, intervalMs: number, enabled = true) {
  const store = getStore(key, fetcher, intervalMs);
  const subscribe = useCallback(
    (listener: () => void) => (enabled ? store.subscribe(listener) : () => {}),
    [store, enabled],
  );
  const data = useSyncExternalStore(subscribe, enabled ? store.getSnapshot : () => null, () => null);
  const refresh = useCallback((options?: { throttleMs?: number }) => store.refresh(options), [store]);
  return { data, refresh };
}

/** Fire-and-forget refresh of a shared poll from outside React (e.g. an event handler). */
export function refreshSharedPoll(key: string) {
  const store = registry.get(key);
  if (store) void store.refresh();
}

/** Test/HMR aid: drop all stores. Not used in normal runtime. */
export function __resetSharedPolls() {
  registry.clear();
}
