import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const catalog = fs.readFileSync("src/lib/access-roles.ts", "utf8");
const editor = fs.readFileSync("src/components/UserAccountsEditor.tsx", "utf8");

test("user account editor offers a controlled recruitment access-role catalog", () => {
  for (const role of ["CEO", "Admin", "HR", "Management", "HOD", "Recruiter", "Interviewer", "Hiring Manager", "Finance Reviewer", "Auditor", "Requester"]) {
    assert.match(catalog, new RegExp(`value: "${role}"`));
  }
  assert.match(editor, /ACCESS_ROLE_OPTIONS/);
  assert.match(editor, /updateAccessRole/);
  assert.match(editor, /recommended permissions/);
});
