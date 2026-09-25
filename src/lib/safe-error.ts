// Turns internal failures into text that is safe to show a public/HR user.
// Raw database and provider errors (SQL text, bind params, Google quota
// payloads, OpenAI/HTTP error bodies, network and parser failures) must never
// reach the client; they are logged server-side instead, tagged with a short
// reference an administrator can search the logs for.

import crypto from "node:crypto";

import { looksTechnical, QUOTA } from "./client-error.ts";

export { looksTechnical };

export type SafeErrorKind = "quota" | "internal" | "message";

export function classifyError(error: unknown): SafeErrorKind {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (QUOTA.test(message)) return "quota";
  if (looksTechnical(message)) return "internal";
  return "message";
}

/**
 * Short, non-guessable reference shown to users instead of the real error
 * (for example "ERR-4F1A9C2B"). Deterministic for a seed so a stored failure
 * can be re-displayed with the same reference that was logged.
 */
export function errorReference(seed?: string) {
  const source = seed ?? crypto.randomUUID();
  return `ERR-${crypto.createHash("sha256").update(source).digest("hex").slice(0, 8).toUpperCase()}`;
}

/**
 * Logs the full technical error server-side and returns the reference to show
 * the user. `context` should hold identifiers only (ids, stage, status),
 * never transcripts, resumes, or contact details.
 */
export function logInternalError(scope: string, error: unknown, context: Record<string, unknown> = {}, reference = errorReference()) {
  const detail = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };
  console.error(`[${scope}]`, { reference, ...context, error: detail });
  return reference;
}

/**
 * For routes that deliberately surface thrown business-rule messages
 * ("Choose another time", validation wording): returns the message when it is
 * product wording, otherwise logs it with a reference and returns `fallback`.
 */
export function publicErrorMessage(error: unknown, fallback: string, scope = "api") {
  const message = error instanceof Error ? error.message.trim() : "";
  if (message && message.length <= 400 && classifyError(error) === "message") return message;
  if (message) logInternalError(scope, error, { suppressedFromClient: true });
  return fallback;
}

export function safeErrorResponse(error: unknown, fallback: string, context = "api") {
  const kind = classifyError(error);
  if (kind === "message") {
    return { message: error instanceof Error && error.message ? error.message : fallback, status: 400 };
  }
  const reference = logInternalError(context, error, { kind });
  if (kind === "quota") {
    return {
      message: "Scheduling is temporarily busy because a connected service has reached its usage limit. Please try again in a few minutes.",
      status: 503,
      code: "service_quota",
      reference,
    };
  }
  return { message: fallback, status: 400, reference };
}
