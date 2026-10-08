import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createDriveOAuthState, verifyDriveOAuthState } from "../src/lib/drive-oauth-state.ts";

test("Drive consent only authorizes the same account and organization, with valid unexpired state", () => {
  const original = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "drive-state-test-secret-with-at-least-32-characters";
  try {
    const actor = { email: "cs6@example.com", organizationId: "client-organization" };
    const state = createDriveOAuthState(actor.email, actor.organizationId);
    assert.equal(verifyDriveOAuthState(state, actor)?.organizationId, actor.organizationId);
    assert.equal(verifyDriveOAuthState(state, { ...actor, email: "other@example.com" }), null);
    assert.equal(verifyDriveOAuthState(state, { ...actor, organizationId: "mclink" }), null);
    assert.equal(verifyDriveOAuthState(`${state}x`, actor), null);
    assert.equal(verifyDriveOAuthState(`${state}.extra`, actor), null);
    const sign = (payload) => {
      const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return `${encoded}.${crypto.createHmac("sha256", process.env.SESSION_SECRET).update(encoded).digest("base64url")}`;
    };
    assert.equal(verifyDriveOAuthState(sign({ ...actor, purpose: "resume-drive", exp: Math.floor(Date.now() / 1000) - 1 }), actor), null);
    assert.equal(verifyDriveOAuthState(sign({ ...actor, purpose: "calendar", exp: Math.floor(Date.now() / 1000) + 600 }), actor), null);
    assert.equal(verifyDriveOAuthState(sign({ email: actor.email, exp: Math.floor(Date.now() / 1000) + 600 }), actor), null);
  } finally {
    if (original === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = original;
  }
});
