import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const catalog = fs.readFileSync("src/lib/access-roles.ts", "utf8");
const editor = fs.readFileSync("src/components/UserAccountsEditor.tsx", "utf8");

test("user account editor offers a controlled recruitment access-role catalog", () => {
  for (const role of ["HR", "Admin", "Custom"]) {
    assert.match(catalog, new RegExp(`value: "${role}"`));
  }
  assert.match(editor, /ACCESS_ROLE_OPTIONS/);
  assert.match(editor, /updateAccessRole/);
  assert.match(editor, /recommended permissions/);
  assert.match(catalog, /canManageCredits/);
  assert.match(catalog, /HR is the only access administrator/);
});
