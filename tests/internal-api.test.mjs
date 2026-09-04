import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { authorizeInternalRequest, internalEntityEnabled, internalEntityAllowed, internalEntitiesConfigured, isInternalApiConfigured, verifyInternalRequest } from "../src/lib/internal-api.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

function reqWith(headers) {
  return new Request("https://portal.example/api/internal/recruitment/voice/queue", { headers });
}

async function withEnv(values, callback) {
  const previous = {};
  for (const [name, value] of Object.entries(values)) {
    previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("internal auth requires the shared secret, presented as Bearer or X-Internal-Secret", () => {
  const prev = process.env.INTERNAL_API_SECRET;
  process.env.INTERNAL_API_SECRET = "s3cr3t-value-1234567890";
  assert.equal(isInternalApiConfigured(), true);
  assert.equal(verifyInternalRequest(reqWith({ authorization: "Bearer s3cr3t-value-1234567890" })), true);
  assert.equal(verifyInternalRequest(reqWith({ "x-internal-secret": "s3cr3t-value-1234567890" })), true);
  assert.equal(verifyInternalRequest(reqWith({ authorization: "Bearer wrong" })), false);
  assert.equal(verifyInternalRequest(reqWith({})), false);
  // no cookie / session fallback exists
  assert.equal(verifyInternalRequest(reqWith({ cookie: "mclink_session=anything" })), false);
  if (prev === undefined) delete process.env.INTERNAL_API_SECRET; else process.env.INTERNAL_API_SECRET = prev;
});

test("verifyInternalRequest is false when the secret is unset", () => {
  const prev = process.env.INTERNAL_API_SECRET;
  delete process.env.INTERNAL_API_SECRET;
  assert.equal(isInternalApiConfigured(), false);
  assert.equal(verifyInternalRequest(reqWith({ authorization: "Bearer anything" })), false);
  if (prev !== undefined) process.env.INTERNAL_API_SECRET = prev;
});

test("entity parsing is comma-separated and case-insensitive", async () => {
  await withEnv({ DATABASE_URL: "postgres://test", INTERNAL_API_ENTITIES: "VOICE_QUEUE, bulk_queue, SCREENING_INVITATIONS" }, () => {
    assert.equal(internalEntitiesConfigured(), true);
    assert.equal(internalEntityAllowed("voice_queue"), true);
    assert.equal(internalEntityEnabled("VOICE_QUEUE"), true);
    assert.equal(internalEntityAllowed("hr_decisions"), false);
    assert.equal(internalEntityAllowed("screening_invitations"), true);
    assert.equal(internalEntityAllowed("all"), false);
  });
});

test("route-specific entities are explicit and do not inherit a parent allowlist entry", () => {
  assert.match(read("src/app/api/internal/recruitment/screening/invitations/route.ts"), /withInternalAuth\("screening_invitations"/);
  assert.match(read("src/app/api/internal/recruitment/bookings/route.ts"), /withInternalAuth\("booking"/);
  assert.match(read("src/app/api/internal/recruitment/bookings/tokens/route.ts"), /withInternalAuth\("booking"/);
  assert.match(read("src/app/api/internal/recruitment/voice/attempts/status/route.ts"), /withInternalAuth\("voice_attempts"/);
  assert.match(read("src/app/api/internal/recruitment/voice/logs/route.ts"), /withInternalAuth\("voice_logs"/);
});

test("internal authorization returns the required status matrix", async () => {
  const secret = "pilot-internal-test-secret";
  const call = (headers, entity = "voice_queue") => authorizeInternalRequest(reqWith(headers), entity);

  await withEnv({ INTERNAL_API_SECRET: secret, INTERNAL_API_ENTITIES: "voice_queue", DATABASE_URL: "postgres://test" }, async () => {
    assert.deepEqual(call({ authorization: `Bearer ${secret}` }), { allowed: true }, "allowed entity proceeds");
    assert.equal(call({}).status, 401, "missing secret is unauthorized");
    assert.equal(call({ authorization: "Bearer wrong" }).status, 401, "wrong secret is unauthorized");
    assert.equal(call({ authorization: "Basic malformed" }).status, 401, "malformed auth is unauthorized");
    assert.equal(call({ authorization: `Bearer ${secret}` }, "hr_decisions").status, 403, "disallowed entity is forbidden");
  });
});

test("missing entity configuration and database configuration fail closed", async () => {
  const secret = "pilot-internal-test-secret";
  await withEnv({ INTERNAL_API_SECRET: secret, INTERNAL_API_ENTITIES: undefined, DATABASE_URL: "postgres://test" }, async () => {
    assert.equal(authorizeInternalRequest(reqWith({ authorization: `Bearer ${secret}` }), "voice_queue").status, 503, "missing entities config fails closed");
  });
  await withEnv({ INTERNAL_API_SECRET: secret, INTERNAL_API_ENTITIES: "voice_queue", DATABASE_URL: undefined }, async () => {
    assert.equal(authorizeInternalRequest(reqWith({ authorization: `Bearer ${secret}` }), "voice_queue").status, 503, "missing database config fails closed");
  });
});

test("internal routes are no-store, non-indexable, and go through the auth wrapper", () => {
  const http = read("src/lib/internal-api-http.ts");
  assert.match(http, /"Cache-Control": "no-store"/);
  assert.match(http, /"X-Robots-Tag": "none"/);
  assert.match(read("src/lib/internal-api.ts"), /timingSafeEqual/);
  assert.match(http, /authorizeInternalRequest/);
  for (const p of [
    "src/app/api/internal/recruitment/voice/queue/route.ts",
    "src/app/api/internal/recruitment/voice/results/route.ts",
    "src/app/api/internal/recruitment/hr-decisions/queue/route.ts",
    "src/app/api/internal/recruitment/bulk/queue/route.ts",
  ]) {
    assert.match(read(p), /withInternalAuth\(/, `${p} must use withInternalAuth`);
    assert.doesNotMatch(read(p), /verifySessionToken|COOKIE_NAME/, `${p} must not accept a session cookie`);
  }
});

test("n8n never receives a database URL — the internal API is the only surface", () => {
  const lib = read("src/lib/internal-recruitment-queries.ts");
  assert.match(lib, /from "@\/db\/client"/);
  // the query layer is server-only; routes wrap it with the secret check
  const spec = read("docs/N8N-SHEETS-TO-API-MIGRATION.md");
  assert.match(spec, /never.*DATABASE_URL|DATABASE_URL.*never/i);
});
