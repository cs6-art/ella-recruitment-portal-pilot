import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const form = fs.readFileSync("src/components/AuthForm.tsx", "utf8");
const styles = fs.readFileSync("src/app/globals.css", "utf8");

test("password fields provide an accessible show and hide control", () => {
  assert.match(form, /showPassword/);
  assert.match(form, /type=\{showPassword \? "text" : "password"\}/);
  assert.match(form, /aria-label=\{showPassword \? "Hide password" : "Show password"\}/);
  assert.match(form, /aria-pressed=\{showPassword\}/);
  assert.match(form, /className="auth-password-toggle"/);
  assert.match(styles, /\.auth-password-toggle:focus-visible/);
});
