export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function requiredString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

export function optionalNumber(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || (typeof value === "number" && Number.isFinite(value));
}

/** Convert human-facing requisition labels to the database contract. */
export function normalizeRequestType(value: unknown): "" | "staff_addition" | "staff_replacement" | null {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return "";
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "staff_addition" || normalized === "staff_replacement") return normalized;
  return null;
}

export function boundedLimit(value: string | null): number {
  const parsed = Number(value || "10");
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.trunc(parsed))) : 10;
}
