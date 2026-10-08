import assert from "node:assert/strict";
import test from "node:test";
import { createDriveOAuthState } from "../src/lib/drive-oauth-state.ts";
import { completeDriveOAuthConnection, persistentDriveRefreshToken } from "../src/lib/drive-oauth-flow.ts";
import { currentTenantOrganizationId, DEFAULT_ORGANIZATION_ID, runWithTenantDatabase } from "../src/lib/tenant-database.ts";

test("callback connects, survives later requests, disconnects and reconnects in the client tenant", async () => {
  const original = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "drive-flow-test-secret-at-least-32-characters";
  try {
    const actor = { email: "cs6@example.com", organizationId: "oauth-review-org", canReviewRole: true };
    const store = new Map();
    const key = (email) => `${currentTenantOrganizationId()}|${email}`;
    const readStatus = async (email) => ({ connected: store.has(key(email)) });
    const connect = () => completeDriveOAuthConnection(createDriveOAuthState(actor.email, actor.organizationId), actor, async (email) => {
      await Promise.resolve();
      store.set(key(email), persistentDriveRefreshToken("refresh", ""));
    }, readStatus);
    assert.equal(await connect(), true);
    assert.equal(store.has(`${DEFAULT_ORGANIZATION_ID}|${actor.email}`), false);
    for (const role of ["role-one", "role-two"]) {
      assert.equal((await runWithTenantDatabase(actor.organizationId, () => readStatus(actor.email))).connected, true, role);
    }
    await runWithTenantDatabase(actor.organizationId, () => store.delete(key(actor.email)));
    assert.equal((await runWithTenantDatabase(actor.organizationId, () => readStatus(actor.email))).connected, false);
    assert.equal(await connect(), true);
    assert.equal(store.size, 1);

    let exchanged = false;
    const exchange = async () => { exchanged = true; };
    const state = createDriveOAuthState(actor.email, actor.organizationId);
    assert.equal(await completeDriveOAuthConnection(state, { ...actor, organizationId: "another-org" }, exchange, readStatus), false);
    assert.equal(await completeDriveOAuthConnection(state, null, exchange, readStatus), false);
    assert.equal(await completeDriveOAuthConnection(state, { ...actor, canReviewRole: false }, exchange, readStatus), false);
    assert.equal(exchanged, false);
    await assert.rejects(completeDriveOAuthConnection(state, actor, exchange, async () => ({ connected: false })), /drive_connection_not_persisted/);
    await assert.rejects(completeDriveOAuthConnection(state, actor, async () => { throw new Error("storage unavailable"); }, readStatus), /storage unavailable/);
  } finally {
    if (original === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = original;
  }
});

test("Drive requires persistent access and preserves an existing refresh token on reauthorization", () => {
  assert.equal(persistentDriveRefreshToken("new", "old"), "new");
  assert.equal(persistentDriveRefreshToken(undefined, "old"), "old");
  assert.throws(() => persistentDriveRefreshToken(undefined, ""), /drive_refresh_token_missing/);
  assert.throws(() => persistentDriveRefreshToken("", ""), /drive_refresh_token_missing/);
});
