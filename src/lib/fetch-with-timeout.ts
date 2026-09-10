/** Fetch wrapper for server-side integrations that must not wait indefinitely. */
export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = Number.isFinite(timeoutMs) ? Math.max(1_000, Math.min(120_000, Math.trunc(timeoutMs))) : 15_000;
  const parentSignal = init.signal;
  const abortFromParent = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

export function timeoutFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.min(120_000, Math.trunc(value)) : fallback;
}
