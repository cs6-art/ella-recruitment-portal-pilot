import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { oauthConnections } from "@/db/schema-recruitment";
import { currentTenantOrganizationId } from "@/lib/tenant-database";

export type OAuthProvider = "google_calendar" | "google_drive" | "microsoft_drive";

export type StoredOAuthConnection = {
  userEmail: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  tokenExpiresAt: Date | null;
  scope: string;
  connectedAt: Date;
};

function key(email: string) {
  return email.trim().toLowerCase();
}

/**
 * Postgres storage for per-user OAuth connections. Tokens arrive and leave
 * already encrypted by the owning module (calendar, Drive, OneDrive), so this
 * layer never sees a plaintext token.
 */
export async function readOAuthConnection(provider: OAuthProvider, email: string, organizationId = currentTenantOrganizationId()): Promise<StoredOAuthConnection | null> {
  const [row] = await getDb().select().from(oauthConnections)
    .where(and(eq(oauthConnections.organizationId, organizationId), eq(oauthConnections.provider, provider), eq(oauthConnections.userEmail, key(email))))
    .limit(1);
  if (!row) return null;
  return { userEmail: row.userEmail, accessTokenEnc: row.accessTokenEnc, refreshTokenEnc: row.refreshTokenEnc, tokenExpiresAt: row.tokenExpiresAt, scope: row.scope, connectedAt: row.connectedAt };
}

export async function saveOAuthConnection(
  provider: OAuthProvider,
  email: string,
  value: { accessTokenEnc: string; refreshTokenEnc: string; tokenExpiresAt: string | Date | null; scope: string; connectedAt?: Date },
  organizationId = currentTenantOrganizationId(),
): Promise<void> {
  const expires = value.tokenExpiresAt ? new Date(value.tokenExpiresAt) : null;
  const tokenExpiresAt = expires && Number.isFinite(expires.getTime()) ? expires : null;
  const normalized = key(email);
  await getDb().insert(oauthConnections).values({
    organizationId,
    userEmail: normalized,
    provider,
    accessTokenEnc: value.accessTokenEnc,
    refreshTokenEnc: value.refreshTokenEnc,
    tokenExpiresAt,
    scope: value.scope,
    accountEmail: normalized,
    ...(value.connectedAt ? { connectedAt: value.connectedAt } : {}),
  }).onConflictDoUpdate({
    target: [oauthConnections.organizationId, oauthConnections.provider, oauthConnections.userEmail],
    set: { accessTokenEnc: value.accessTokenEnc, refreshTokenEnc: value.refreshTokenEnc, tokenExpiresAt, scope: value.scope, accountEmail: normalized, updatedAt: new Date() },
  });
}

export async function deleteOAuthConnection(provider: OAuthProvider, email: string, organizationId = currentTenantOrganizationId()): Promise<void> {
  await getDb().delete(oauthConnections)
    .where(and(eq(oauthConnections.organizationId, organizationId), eq(oauthConnections.provider, provider), eq(oauthConnections.userEmail, key(email))));
}
