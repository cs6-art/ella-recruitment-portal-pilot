import type { ReactNode } from "react";

export type StatusTone = "positive" | "progress" | "warning" | "negative" | "neutral" | "info";

function normalizeStatus(value: string) {
  return value.trim().toLowerCase().replace(/[\u2013\u2014_-]+/g, " ").replace(/\s+/g, " ");
}

const statusToneMap: Record<string, StatusTone> = {
  active: "positive",
  approved: "positive",
  available: "positive",
  booked: "warning",
  completed: "positive",
  connected: "positive",
  hired: "positive",
  job_posted: "progress",
  "job posted": "progress",
  passed: "positive",
  published: "positive",
  ready: "positive",
  screened: "positive",
  successful: "positive",
  cancelled: "negative",
  canceled: "negative",
  blocked: "negative",
  error: "negative",
  failed: "negative",
  "no show": "negative",
  rejected: "negative",
  archived: "neutral",
  draft: "neutral",
  inactive: "neutral",
  "not started": "neutral",
  other: "neutral",
  skipped: "neutral",
  "account mismatch": "warning",
  expired: "warning",
  needs_review: "warning",
  "needs review": "warning",
  pending: "warning",
  "pending hr discussion": "warning",
  "pending hr review": "warning",
  "pending management approval": "warning",
  processing: "progress",
  queued: "warning",
  "recruitment setup": "progress",
  retry_scheduled: "warning",
  "retry scheduled": "warning",
  scheduled: "warning",
  screening: "progress",
  interviewing: "progress",
  "in progress": "progress",
  "under review": "progress",
  "awaiting review": "progress",
  "review complete": "positive",
  "returned for revision": "warning",
  "on hold": "neutral",
};

export function statusTone(value: string): StatusTone {
  const normalized = normalizeStatus(value);
  return statusToneMap[normalized] || statusToneMap[normalized.replace(/ /g, "_")] || "neutral";
}

type StatusBadgeProps = {
  value: string;
  label?: ReactNode;
  tone?: StatusTone;
  className?: string;
};

export default function StatusBadge({ value, label = value, tone, className = "" }: StatusBadgeProps) {
  const resolvedTone = tone || statusTone(value);
  return <span className={`status-badge status-tone-${resolvedTone} ${className}`.trim()} data-status={normalizeStatus(value)}>{label}</span>;
}
