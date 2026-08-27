/**
 * Short-TTL cache + backoff wrapper for Google Sheets operations.
 *
 * A single `values.get` call costs the same read-quota unit regardless of
 * how many rows it returns, but repeating that call — which this codebase
 * does a lot, e.g. reserveBooking() reading the same tab three times in one
 * request — burns through the 60 reads/min quota fast. This module makes
 * "read once, serve repeats from cache for a few seconds" the default.
 *
 * Scoped to a single always-on Node process (this app runs as `next
 * start`/`next dev`, not serverless functions), so a module-level Map is a
 * valid cache store — it would NOT work across multiple serverless
 * instances. For that scale, see the note in reserveBooking() about moving
 * to a real database as the read source.
 */

type CacheEntry<T> = { value: T; expiresAt: number; cachedAt: number };

const TTL_MS = 20_000;
// Leave headroom below Google's default 60 reads/minute/user quota. This is
// process-local; deployments with multiple instances need a shared limiter.
const MIN_READ_INTERVAL_MS = 1_200;
const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
let readQueue = Promise.resolve();
let nextReadAt = 0;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForReadSlot(): Promise<void> {
  const previous = readQueue;
  let release!: () => void;
  readQueue = new Promise((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    const delay = Math.max(0, nextReadAt - Date.now());
    if (delay > 0) await wait(delay);
    nextReadAt = Date.now() + MIN_READ_INTERVAL_MS;
  } finally {
    release();
  }
}

function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|quota|RESOURCE_EXHAUSTED/i.test(message);
}

export async function withSheetsBackoff<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isQuotaError(error) || attempt === attempts - 1) throw error;
      // Google recommends truncated exponential backoff for time-based quota
      // errors. A 1s/2s retry window is shorter than the Sheets quota window.
      const delay = Math.min(30_000, 2_000 * 2 ** attempt) + Math.random() * 1_000;
      await wait(delay);
    }
  }
  throw lastError;
}

/**
 * Reads through the cache under `key`. On a genuine quota error with no
 * fresh data available, serves the last-known value (however stale) rather
 * than failing the request outright — a booking page showing 30-second-old
 * slot availability is a far better failure mode than a 500 error.
 */
export async function cachedSheetsRead<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && entry.expiresAt > now) return entry.value;

  const existingRead = inFlight.get(key) as Promise<T> | undefined;
  if (existingRead) return existingRead;

  const read = (async () => {
    try {
      await waitForReadSlot();
      const value = await withSheetsBackoff(fetcher);
      const cachedAt = Date.now();
      cache.set(key, { value, expiresAt: cachedAt + TTL_MS, cachedAt });
      return value;
    } catch (error) {
      if (entry && isQuotaError(error)) {
        console.warn(`[Sheets Cache] Quota error reading "${key}"; serving stale cache (age ${Math.round((Date.now() - entry.cachedAt) / 1000)}s).`);
        return entry.value;
      }
      throw error;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, read);
  return read;
}

/**
 * Read through the shared pacing/backoff path while deliberately skipping the
 * value cache. This is for externally-written, user-visible state such as the
 * n8n bulk queue, where freshness matters but repeated polling must still
 * respect Sheets quota.
 */
export async function freshSheetsRead<T>(fetcher: () => Promise<T>): Promise<T> {
  await waitForReadSlot();
  return withSheetsBackoff(fetcher);
}

/** Call after any write to a tab so the next read reflects it, instead of
 * serving up-to-20s-stale data right after the app itself changed it. */
export function invalidateSheetsCache(tabPrefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${tabPrefix}:`)) cache.delete(key);
  }
}
