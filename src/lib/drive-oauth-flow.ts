import { verifyDriveOAuthState } from "./drive-oauth-state.ts";
import { runWithTenantDatabase } from "./tenant-database.ts";

type Actor = { email: string; organizationId: string; canReviewRole: boolean };

/** A successful callback must save and read back a durable connection in the initiating tenant. */
export async function completeDriveOAuthConnection(
  state: string,
  actor: Actor | null,
  exchange: (email: string) => Promise<void>,
  readStatus: (email: string) => Promise<{ connected: boolean }>,
): Promise<boolean> {
  const payload = actor?.canReviewRole === true ? verifyDriveOAuthState(state, actor) : null;
  if (!payload) return false;
  await runWithTenantDatabase(payload.organizationId, async () => {
    await exchange(payload.email);
    if (!(await readStatus(payload.email)).connected) throw new Error("drive_connection_not_persisted");
  });
  return true;
}

/** Reauthorization may omit the refresh token; a new connection cannot. */
export function persistentDriveRefreshToken(received: string | undefined, previous: string): string {
  const token = received || previous;
  if (!token) throw new Error("drive_refresh_token_missing");
  return token;
}
