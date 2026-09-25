// Turns internal failures into text that is safe to show a public/HR user.
// Raw database and provider errors (SQL text, bind params, Google quota
// payloads) must never reach the client; they are logged server-side instead.

const SQL_LEAK = /\b(select|insert|update|delete)\b[\s\S]*\b(from|into|set|where)\b|failed query|\bparams?:|\$\d+\b|violates .*constraint|relation ".*" does not exist|syntax error at or near|duplicate key value|deadlock detected|current transaction is aborted|\bpg_|drizzle/i;
const QUOTA = /quota|rate ?limit|resource[_ ]exhausted|too many requests|\b429\b|userRateLimitExceeded/i;

export type SafeErrorKind = "quota" | "internal" | "message";

export function classifyError(error: unknown): SafeErrorKind {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (QUOTA.test(message)) return "quota";
  if (SQL_LEAK.test(message)) return "internal";
  return "message";
}

export function safeErrorResponse(error: unknown, fallback: string, context = "api") {
  const kind = classifyError(error);
  if (kind === "message") {
    return { message: error instanceof Error && error.message ? error.message : fallback, status: 400 };
  }
  console.error(`[${context}] ${kind} error suppressed from client:`, error);
  if (kind === "quota") {
    return {
      message: "Scheduling is temporarily busy because a connected service has reached its usage limit. Please try again in a few minutes.",
      status: 503,
      code: "service_quota",
    };
  }
  return { message: fallback, status: 400 };
}
