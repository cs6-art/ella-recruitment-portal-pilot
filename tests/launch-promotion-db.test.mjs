// Real-database check of the "first 100 organizations" promotion.
//
// Skipped unless LAUNCH_TEST_DATABASE_URL points at a THROWAWAY Postgres whose
// database name contains "test" (the test drops and recreates the public
// schema). It also needs the `pg` package: `npm i --no-save pg`.
//
//   LAUNCH_TEST_DATABASE_URL=postgres://postgres:pw@localhost:5432/launchtest npm run test -- tests/launch-promotion-db.test.mjs
//
// It applies every migration in drizzle/, then registers 105 organizations at
// the same instant and proves exactly 100 receive the 250-credit grant.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

const url = process.env.LAUNCH_TEST_DATABASE_URL?.trim();
const databaseName = url ? new URL(url).pathname.replace(/^\//, "") : "";
let pgModule = null;
try { pgModule = url ? await import("pg") : null; } catch { pgModule = null; }
const skip = !url ? "set LAUNCH_TEST_DATABASE_URL to run" : !/test/i.test(databaseName) ? "database name must contain 'test'" : !pgModule ? "install pg: npm i --no-save pg" : false;

test("first-100 promotion against a real Postgres", { skip }, async () => {
  const { Pool } = pgModule.default || pgModule;
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { eq } = await import("drizzle-orm");
  const schema = await import("../src/db/schema.ts");
  const { grantWelcomeCredits } = await import("../src/lib/organization-welcome-credits.ts");
  const promo = await import("../src/lib/launch-promotion.ts");

  const admin = new Pool({ connectionString: url });
  await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  for (const file of fs.readdirSync("drizzle").filter((name) => name.endsWith(".sql")).sort()) {
    await admin.query(fs.readFileSync(`drizzle/${file}`, "utf8"));
  }
  const pool = new Pool({ connectionString: url, max: 40 });
  const db = drizzle(pool, { schema });
  try {
    const balanceOf = async (id) => (await db.select().from(schema.creditAccounts).where(eq(schema.creditAccounts.organizationId, id)))[0]?.balance;
    const createOrg = async (tag) => {
      const id = crypto.randomUUID();
      const credits = await db.transaction(async (tx) => {
        await tx.insert(schema.organizations).values({ id, slug: `${tag}-${id.slice(0, 8)}`, name: `Org ${tag}`, databaseKey: `${tag}-${id.slice(0, 8)}`, databaseStatus: "shared" });
        return grantWelcomeCredits(tx, id);
      });
      return { id, credits };
    };

    // Seeded inactive: an organization created now gets the normal default, and activation never touches it.
    const existing = await createOrg("existing");
    assert.equal(existing.credits, 40);
    const seeded = await promo.getLaunchPromotionStatus(db);
    assert.deepEqual([seeded.active, seeded.allocatedCount, seeded.maxAllocations, seeded.credits], [false, 0, 100, 250]);
    await promo.setLaunchPromotionActive(db, true);
    assert.equal(await balanceOf(existing.id), 40);

    // 105 organizations register at the same instant.
    const results = await Promise.all(Array.from({ length: 105 }, (_, index) => createOrg(`burst${index}`)));
    assert.equal(results.filter((result) => result.credits === 250).length, 100);
    assert.equal(results.filter((result) => result.credits === 40).length, 5);
    const status = await promo.getLaunchPromotionStatus(db);
    assert.deepEqual([status.allocatedCount, status.remaining], [100, 0]);
    const allocations = await db.select().from(schema.launchPromotionAllocations);
    assert.deepEqual(allocations.map((row) => row.sequenceNumber).sort((a, b) => a - b), Array.from({ length: 100 }, (_, index) => index + 1));

    // One grant entry per organization, labelled correctly, balance equal to the grant.
    const ledger = (await pool.query("select a.organization_id, l.event, l.credits_delta, l.note from credit_account_ledger l join credit_accounts a on a.id = l.account_id")).rows;
    for (const result of results) {
      const rows = ledger.filter((row) => row.organization_id === result.id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].event, result.credits === 250 ? "launch_welcome_credit" : "welcome_credit");
      assert.equal(rows[0].credits_delta, result.credits);
      assert.equal(await balanceOf(result.id), result.credits);
    }
    const promoted = results.find((result) => result.credits === 250);
    assert.equal(ledger.find((row) => row.organization_id === promoted.id).note, "Event Welcome Credits");

    // Never twice, and the database itself refuses to exceed the cap.
    await db.transaction(async (tx) => assert.equal(await grantWelcomeCredits(tx, promoted.id), 0));
    assert.equal(await balanceOf(promoted.id), 250);
    await assert.rejects(() => pool.query("update launch_promotions set allocated_count = 101"), /launch_promotions_allocated_within_cap/);

    // A creation that fails after claiming gives its slot back.
    await pool.query("update launch_promotions set max_allocations = 101");
    await assert.rejects(() => db.transaction(async (tx) => {
      const id = crypto.randomUUID();
      await tx.insert(schema.organizations).values({ id, slug: `fail-${id.slice(0, 8)}`, name: "Fails", databaseKey: `fail-${id.slice(0, 8)}`, databaseStatus: "shared" });
      await grantWelcomeCredits(tx, id);
      throw new Error("creation failed");
    }), /creation failed/);
    assert.equal((await promo.getLaunchPromotionStatus(db)).allocatedCount, 100);

    // Without the migration, organization creation still works with the normal default.
    await pool.query("alter table launch_promotions rename to launch_promotions_off");
    assert.equal((await createOrg("nomigration")).credits, 40);
    await pool.query("alter table launch_promotions_off rename to launch_promotions");
  } finally {
    await pool.end();
    await admin.end();
  }
});
