import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("team invitations send a prefilled registration link and expose delivery status", () => {
  const route = read("src/app/api/organizations/team-invites/route.ts");
  assert.match(route, /sendTeamInvitationEmail/);
  assert.match(route, /inviteLink\.searchParams\.set\("register", "1"\)/);
  assert.match(route, /inviteLink\.searchParams\.set\("email", email\)/);
  assert.match(route, /emailSent: false/);
  assert.match(route, /emailSent: true/);
});

test("the invitation email explains that registration is followed by verification and login", () => {
  const registration = read("src/lib/registration.ts");
  assert.match(registration, /sendTeamInvitationEmail/);
  assert.match(registration, /register with this email address and verify your account/);
  assert.match(registration, /After you confirm your email, return to the portal to log in/);
  assert.match(registration, /verificationLink: input\.link/);
});

test("verification lands on the login form", () => {
  const verifyRoute = read("src/app/api/auth/verify/route.ts");
  const homePage = read("src/app/page.tsx");
  assert.match(verifyRoute, /NextResponse\.redirect\(`\$\{base\}\/\?verify=\$\{result\.status\}`/);
  assert.match(homePage, /verified: "Your email is verified\. You can now log in\."/);
});
