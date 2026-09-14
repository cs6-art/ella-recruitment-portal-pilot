import { AsyncLocalStorage } from "node:async_hooks";

/** The original McLink database is both the control plane and the default tenant. */
export const DEFAULT_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

type TenantContext = { organizationId: string };
const tenantContext = new AsyncLocalStorage<TenantContext>();
let parsedUrls: Record<string, string> | null | undefined;

function normalizedId(value: string | undefined) {
  return value?.trim() || DEFAULT_ORGANIZATION_ID;
}

function tenantDatabaseUrls(): Record<string, string> {
  if (parsedUrls) return parsedUrls;
  if (parsedUrls === null) return {};
  const raw = process.env.TENANT_DATABASE_URLS?.trim();
  if (!raw) {
    parsedUrls = null;
    return {};
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("must be an object");
    parsedUrls = Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0).map(([key, url]) => [key.trim(), url.trim()]));
    return parsedUrls;
  } catch (error) {
    throw new Error(`TENANT_DATABASE_URLS must be valid JSON: ${error instanceof Error ? error.message : "invalid object"}`);
  }
}

export function currentTenantOrganizationId() {
  return tenantContext.getStore()?.organizationId || DEFAULT_ORGANIZATION_ID;
}

export function configuredTenantOrganizationIds() {
  return Object.keys(tenantDatabaseUrls()).filter((id) => id !== DEFAULT_ORGANIZATION_ID);
}

/**
 * Run all tenant-owned queries inside the selected physical database context.
 * The context is request-local, so concurrent client requests cannot switch
 * each other's database.
 */
export function runWithTenantDatabase<T>(organizationId: string, callback: () => Promise<T> | T): Promise<T> | T {
  const id = normalizedId(organizationId);
  return tenantContext.run({ organizationId: id }, callback);
}

/** Used by session verification so existing route handlers automatically use the signed-in tenant. */
export function enterTenantDatabase(organizationId: string) {
  tenantContext.enterWith({ organizationId: normalizedId(organizationId) });
}

export function tenantDatabaseUrl(organizationId = currentTenantOrganizationId()): string | undefined {
  const id = normalizedId(organizationId);
  if (id === DEFAULT_ORGANIZATION_ID) return process.env.DATABASE_URL?.trim();
  return tenantDatabaseUrls()[id];
}

export function isTenantDatabaseConfigured(organizationId = currentTenantOrganizationId()) {
  return Boolean(tenantDatabaseUrl(organizationId));
}

export function resetTenantDatabaseConfigForTests() {
  parsedUrls = undefined;
}
