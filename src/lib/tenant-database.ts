import { AsyncLocalStorage } from "node:async_hooks";

/** The original McLink database is both the control plane and the default tenant. */
export const DEFAULT_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

type TenantContext = { organizationId: string };
const tenantContext = new AsyncLocalStorage<TenantContext>();

function normalizedId(value: string | undefined) {
  return value?.trim() || DEFAULT_ORGANIZATION_ID;
}

export function currentTenantOrganizationId() {
  return tenantContext.getStore()?.organizationId || DEFAULT_ORGANIZATION_ID;
}

/**
 * Run all tenant-owned queries inside the selected organization's context.
 * The context is request-local, so concurrent client requests cannot switch
 * each other's organization.
 *
 * Every organization shares one physical database (see `/api/organizations`
 * POST -- new orgs are created in "shared" mode and nothing else provisions
 * them). Isolation between organizations is enforced entirely by the
 * `organization_id` column on every tenant-owned table plus the query
 * predicates in `internal-recruitment-queries.ts` / `recruitment-target-portal.ts`
 * -- this function's only remaining job is to carry *which* organization_id
 * a request is acting as through async calls that don't thread it explicitly
 * (e.g. `getTenantDb()`, credit balance lookups).
 */
export function runWithTenantDatabase<T>(organizationId: string, callback: () => Promise<T> | T): Promise<T> | T {
  const id = normalizedId(organizationId);
  return tenantContext.run({ organizationId: id }, callback);
}

/** Used by session verification so existing route handlers automatically use the signed-in tenant. */
export function enterTenantDatabase(organizationId: string) {
  tenantContext.enterWith({ organizationId: normalizedId(organizationId) });
}

/** Every organization currently shares this one physical database. */
export function tenantDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL?.trim();
}

export function isTenantDatabaseConfigured() {
  return Boolean(tenantDatabaseUrl());
}
