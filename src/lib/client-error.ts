// Browser-safe error wording rules, shared by server routes (safe-error.ts)
// and client components. No Node imports: this file ships to the browser.

export const SQL_LEAK = /\b(select|insert|update|delete)\b[\s\S]*\b(from|into|set|where)\b|failed query|\bparams?:|\$\d+\b|violates .*constraint|relation ".*" does not exist|syntax error at or near|duplicate key value|deadlock detected|current transaction is aborted|\bpg_|drizzle/i;
export const QUOTA = /quota|rate ?limit|resource[_ ]exhausted|too many requests|\b429\b|userRateLimitExceeded/i;
// Provider/HTTP/runtime error shapes: "400 Response input…", "Request failed
// with status 500", SDK/network codes, parser errors, key/endpoint mentions.
export const TECHNICAL_LEAK = /^\s*[45]\d{2}\s|\bstatus(?: code)? [45]\d{2}\b|\bhttps?:\/\/|\bapi[_ -]?key\b|\bopenai\b|\btext\.format\b|response_format|json_object|json_schema|\binvalid_request_error\b|\bECONN\w*|\bENOTFOUND\b|\bETIMEDOUT\b|\bEAI_AGAIN\b|fetch failed|failed to fetch|networkerror|load failed|socket hang up|\bUnexpected (?:token|end of JSON)\b|is not valid JSON|JSON\.parse|\bTypeError\b|\bReferenceError\b|Cannot read propert|is not a function|\n\s+at\s/i;

/** True when a message looks like a raw technical error rather than product wording. */
export function looksTechnical(message: string) {
  return SQL_LEAK.test(message) || TECHNICAL_LEAK.test(message);
}

/**
 * Message to show for an error caught in a component. Messages the component
 * threw from an API's `error` field (already safe wording) pass through;
 * browser network/parse failures (TypeError "Failed to fetch", SyntaxError
 * from an HTML error page) and anything technical become `fallback`.
 */
export function clientErrorMessage(caught: unknown, fallback: string) {
  if (!(caught instanceof Error)) return fallback;
  if (caught.name === "TypeError" || caught.name === "SyntaxError" || caught.name === "AbortError") return fallback;
  const message = caught.message.trim();
  if (!message || message.length > 400 || looksTechnical(message) || QUOTA.test(message)) return fallback;
  return message;
}
