import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("intake role resolution selects Postgres before applying published-role validation", () => {
  const resolver = read("src/lib/recruitment-role-resolution.ts");
  assert.match(resolver, /isPostgresRecruitmentTarget\(\)/);
  assert.match(resolver, /targetRoleDetails\(normalizedRoleId\)/);
  assert.match(resolver, /import\("@\/lib\/google-sheets"\)/);
  assert.match(resolver, /isPublishedRoleForIntake\(role\)/);
  assert.match(resolver, /return role && isPublishedRoleForIntake\(role\) \? role : null/);
});

test("Postgres target role resolution does not statically load the Sheets repository", () => {
  const resolver = read("src/lib/recruitment-role-resolution.ts");
  assert.doesNotMatch(resolver, /import \{[^}]+\} from ["']@\/lib\/google-sheets["']/);
  assert.match(resolver, /legacy behavior/);
});

test("Postgres intake routes do not perform a direct Sheets role lookup", () => {
  for (const file of [
    "src/app/api/public/applications/route.ts",
    "src/app/api/resume-screening/bulk/upload/route.ts",
    "src/app/api/resume-screening/drive/import/route.ts",
    "src/app/api/resume-screening/onedrive/import/route.ts",
  ]) {
    const route = read(file);
    assert.match(route, /resolvePublishedRecruitmentRole\(roleId\)/, `${file} must use the shared resolver`);
    assert.doesNotMatch(route, /getRoleRequestById\(roleId\)/, `${file} must not gate target intake through Sheets`);
    assert.doesNotMatch(route, /isPublishedRoleForIntake\(role\)/, `${file} must not duplicate the source-specific gate`);
  }
});

test("target intake preserves no-charge queue-first credit timing", () => {
  const target = read("src/lib/recruitment-target-bulk.ts");
  assert.match(target, /const creditsCharged = 0/);
  assert.match(target, /status: "queued"/);
  assert.doesNotMatch(target, /recordDeduction/);
});

test("legacy Sheets mode remains the resolver fallback", () => {
  const resolver = read("src/lib/recruitment-role-resolution.ts");
  assert.match(resolver, /return getRoleRequestById\(normalizedRoleId\)/);
  assert.match(read("src/lib/recruitment-target-mode.ts"), /=== "postgres"/);
});
