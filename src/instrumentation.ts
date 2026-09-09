/**
 * Keep server startup free of work that assumes a long-lived Node process.
 *
 * Vercel serverless instances may be frozen between requests, so timers here
 * are both unreliable for maintenance and a source of idle Fluid CPU. Resume
 * retention is available through the authenticated cleanup route and uploads
 * retain their existing once-per-process safety cleanup.
 */
export function register() {
  // Intentionally no timers, loops, database reads, or external API calls.
}
