import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("payments schema keeps money in Postgres and separate from the credit ledger", () => {
  const schema = read("src/db/schema.ts");
  assert.match(schema, /pgTable\(\s*"payments"/);
  assert.match(schema, /pgTable\(\s*"payment_events"/);
  assert.match(schema, /reference.*\.notNull\(\)\.unique\(\)/s);
  assert.match(schema, /credit_ledger_source_id/);
  const sql = read("drizzle/0002_payments.sql");
  assert.match(sql, /create table if not exists "payments"/i);
  assert.match(sql, /"dedupe_key"\s+text unique/i);
});

test("a frontend redirect never grants credits — only a verified provider update does", () => {
  const payments = read("src/lib/payments.ts");
  // the only recordTopUp call is inside handleProviderUpdate, gated on mapped === 'paid'
  const grantCalls = payments.match(/recordTopUp\(/g) || [];
  assert.equal(grantCalls.length, 1, "exactly one ledger grant call");
  assert.match(payments, /if \(mapped !== "paid"\)/);
  assert.match(payments, /idempotencyKey: grantKeyFor\(payment\.reference\)/);
  // the create route's return URL is just informational
  const createRoute = read("src/app/api/ella-credits/payments/route.ts");
  assert.doesNotMatch(createRoute, /recordTopUp|recordDeduction/);
});

test("the webhook verifies the signature before any processing and is idempotent", () => {
  const route = read("src/app/api/webhooks/hitpay/route.ts");
  assert.match(route, /verifyFormWebhook|verifyJsonWebhook/);
  assert.match(route, /if \(!signatureValid\)/);
  assert.match(route, /status: 401/);
  // 200 on every verified callback so HitPay stops retrying
  assert.match(route, /received: true/);
  const payments = read("src/lib/payments.ts");
  // event-layer dedupe: a replayed webhook is a no-op insert
  assert.match(payments, /dedupeKey/);
  assert.match(payments, /outcome: "already_processed"/);
});

test("amount is server-calculated and a provider mismatch is never credited", () => {
  const payments = read("src/lib/payments.ts");
  assert.match(payments, /findCreditPack\(input\.packId\)/);
  assert.match(payments, /amountCents: pack\.amountCents/);
  assert.match(payments, /providerCents !== payment\.amountCents/);
  assert.match(payments, /providerCents === null/);
  assert.match(payments, /outcome: "amount_mismatch"/);
  const createRoute = read("src/app/api/ella-credits/payments/route.ts");
  // request body only carries a packId — no amount / credits from the client
  assert.match(createRoute, /z\.object\(\{ packId:/);
  assert.doesNotMatch(createRoute, /amountCents:\s*z\./);
});

test("only the payment-event dedupe conflict is treated as an already-processed replay", () => {
  const payments = read("src/lib/payments.ts");
  assert.match(payments, /isPaymentEventDedupeConflict\(error\)/);
  assert.match(payments, /if \(isPaymentEventDedupeConflict\(error\)\)/);
  assert.match(payments, /throw error/);
  const validation = read("src/lib/payment-validation.ts");
  assert.match(validation, /code === "23505"/);
  assert.match(validation, /dedupe_key/);
});

test("the HitPay API base contract includes /v1", () => {
  const hitpay = read("src/lib/hitpay.ts");
  assert.match(hitpay, /SANDBOX_BASE = "https:\/\/api\.sandbox\.hit-pay\.com\/v1"/);
  assert.match(read(".env.example"), /HITPAY_API_URL=https:\/\/api\.sandbox\.hit-pay\.com\/v1/);
});

test("payment routes are RBAC-gated to the credits-manage tier and fail safe when unconfigured", () => {
  const createRoute = read("src/app/api/ella-credits/payments/route.ts");
  assert.match(createRoute, /canManageCredits\(user\)/);
  assert.match(createRoute, /isPaymentsConfigured\(\)/);
  assert.match(createRoute, /code: "NOT_CONFIGURED"/);
  assert.match(createRoute, /status: 503/);
});

test("reconcile re-runs the same idempotent transition (missed-webhook recovery)", () => {
  const payments = read("src/lib/payments.ts");
  assert.match(payments, /export async function reconcilePayment/);
  assert.match(payments, /source: "reconcile"/);
  assert.match(payments, /getPaymentRequest\(payment\.providerPaymentId\)/);
});
