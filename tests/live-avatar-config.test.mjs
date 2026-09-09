import assert from "node:assert/strict";
import test from "node:test";

import { isLiveAvatarConfigured } from "../src/lib/live-avatar.ts";

const KEYS = ["LIVEAVATAR_API_KEY", "LIVEAVATAR_AVATAR_ID", "LIVEAVATAR_VOICE_AGENT_ID"];

function withEnv(overrides, fn) {
  const original = {};
  for (const key of KEYS) original[key] = process.env[key];
  try {
    for (const key of KEYS) delete process.env[key];
    Object.assign(process.env, overrides);
    fn();
  } finally {
    for (const key of KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

test("isLiveAvatarConfigured is false when any required env var is missing", () => {
  withEnv({}, () => {
    assert.equal(isLiveAvatarConfigured(), false);
  });
  withEnv({ LIVEAVATAR_API_KEY: "key", LIVEAVATAR_AVATAR_ID: "avatar" }, () => {
    assert.equal(isLiveAvatarConfigured(), false);
  });
});

test("isLiveAvatarConfigured is true once all three env vars are set", () => {
  withEnv(
    {
      LIVEAVATAR_API_KEY: "key",
      LIVEAVATAR_AVATAR_ID: "avatar",
      LIVEAVATAR_VOICE_AGENT_ID: "agent",
    },
    () => {
      assert.equal(isLiveAvatarConfigured(), true);
    },
  );
});

test("isLiveAvatarConfigured treats blank strings as unset", () => {
  withEnv(
    {
      LIVEAVATAR_API_KEY: "   ",
      LIVEAVATAR_AVATAR_ID: "avatar",
      LIVEAVATAR_VOICE_AGENT_ID: "agent",
    },
    () => {
      assert.equal(isLiveAvatarConfigured(), false);
    },
  );
});


