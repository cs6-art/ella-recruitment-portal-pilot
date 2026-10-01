import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");
const readinessSource = read("src/lib/organization-readiness.ts");

function readinessRules() {
  const progress = readinessSource.match(/export function calculateRequiredSetupProgress\(input: \{[\s\S]*?\}\) \{[\s\S]*?\n\}/)?.[0];
  const status = readinessSource.match(/export function calculateOrganizationSetupStatus\(input: \{[\s\S]*?\}\): OrganizationSetupStatus \{[\s\S]*?\n\}/)?.[0];
  assert.ok(progress, "the required-setup progress function is present");
  assert.ok(status, "the overall-status function is present");
  const plainProgress = progress.replace(/^export function calculateRequiredSetupProgress\(input: \{[\s\S]*?\}\) \{/, "function calculateRequiredSetupProgress(input) {");
  const plainStatus = status.replace(/^export function calculateOrganizationSetupStatus\(input: \{[\s\S]*?\}\): OrganizationSetupStatus \{/, "function calculateOrganizationSetupStatus(input) {");
  return new Function(`${plainProgress}\n${plainStatus}\nreturn { calculateRequiredSetupProgress, calculateOrganizationSetupStatus };`)();
}

test("readiness requires only available credits, applicable interview services, and a published role", () => {
  const { calculateRequiredSetupProgress, calculateOrganizationSetupStatus } = readinessRules();
  const base = {
    creditsAdded: true,
    recordingStorageApplicable: false,
    recordingStorageReady: false,
    googleCalendarApplicable: false,
    googleCalendarReady: false,
    firstRolePublished: true,
  };

  assert.deepEqual(calculateRequiredSetupProgress({ ...base, brandingConfigured: false, hasCandidates: false, hasTeammates: false, automatedEmailsCustomized: false }), { complete: 2, total: 2 });
  assert.equal(calculateOrganizationSetupStatus(base), "Ready to recruit");
  assert.deepEqual(calculateRequiredSetupProgress({ ...base, recordingStorageApplicable: true }), { complete: 2, total: 3 });
  assert.equal(calculateOrganizationSetupStatus({ ...base, googleCalendarApplicable: true }), "Partially configured");
  assert.equal(calculateOrganizationSetupStatus({ ...base, recordingStorageApplicable: true, recordingStorageReady: true, googleCalendarApplicable: true, googleCalendarReady: true }), "Ready to recruit");
});

test("organization creation needs no owner email or invitation; the first verified registrant becomes owner", () => {
  const route = read("src/app/api/organizations/route.ts");
  assert.doesNotMatch(route, /ownerEmail|sendOrganizationOwnerInvitation|invitationStatus/);
  assert.match(route, /allowedDomains: z\.array/);
  assert.match(route, /rules\.allowedDomains\.length === 0 && rules\.allowedEmails\.length === 0/, "someone must be allowed to register so an owner can be assigned");
  assert.equal(fs.existsSync("src/lib/organization-owner-invite.ts"), false);
  assert.equal(fs.existsSync("src/app/api/organizations/owner-invitation/route.ts"), false);
  assert.doesNotMatch(read(".env.example"), /N8N_ORGANIZATION_OWNER_INVITE_WEBHOOK_URL/);
});

test("organization allowlists reject overlapping individual addresses and domains", () => {
  const route = read("src/app/api/organizations/route.ts");
  assert.match(route, /already assigned to \$\{other\.name\}/);
  assert.match(route, /domainWithExistingInvite/);
  assert.match(route, /directEmailMatchingOtherDomain/);
  const registration = read("src/lib/registration.ts");
  assert.match(registration, /if \(byEmail\.length\) return byEmail\.length === 1 \? byEmail\[0\]\.id : null/);
  assert.match(registration, /return byDomain\.length === 1 \? byDomain\[0\]\.id : null/);
});

test("first verified registrant remains the owner, and readiness checks only the session organization", () => {
  const directory = read("src/lib/postgres-directory.ts");
  const claim = directory.match(/export async function claimOrganizationOwnershipIfNone[\s\S]*?\n\}/)?.[0] || "";
  assert.match(claim, /eq\(users\.isOrganizationOwner, true\)/);
  assert.match(claim, /eq\(users\.email, normalizedEmail\)/);
  assert.doesNotMatch(claim, /organizations\.ownerEmail/);
  assert.match(read("src/lib/registration.ts"), /first person to register into a client organization owns it/);

  const readinessRoute = read("src/app/api/organization/readiness/route.ts");
  assert.match(readinessRoute, /getOrganizationReadiness\(user\.organizationId\)/);
  assert.doesNotMatch(readinessRoute, /organizationId:\s*readiness/);
  assert.match(readinessSource, /eq\(applications\.organizationId, organizationId\)/);
  assert.match(readinessSource, /eq\(users\.organizationId, organizationId\)/);
  assert.match(readinessSource, /eq\(oauthConnections\.organizationId, organizationId\)/);
  assert.match(readinessSource, /eq\(portalSettings\.organizationId, organizationId\)/);
  assert.doesNotMatch(readinessSource, /accessTokenEnc\s*:/);
  assert.doesNotMatch(readinessSource, /refreshTokenEnc\s*:/);
});

test("admin organization responses use public slugs, never database keys or internal IDs", () => {
  const route = read("src/app/api/organizations/route.ts");
  const publicShape = route.match(/function publicOrganization\([\s\S]*?\n\}/)?.[0] || "";
  assert.match(route, /organization: publicOrganization\(created\)/);
  assert.match(route, /readiness: await getOrganizationReadiness\(row\.id\)/);
  const returnedFields = publicShape.slice(publicShape.indexOf("return {"));
  assert.doesNotMatch(returnedFields, /id:\s*row\.id|databaseKey|databaseStatus/);
  const editor = read("src/components/UserAccountsEditor.tsx");
  assert.match(editor, /organizationSlug=/);
  assert.doesNotMatch(editor, /organizationId=/);
  const directory = read("src/app/api/user-directory/route.ts");
  assert.match(directory, /searchParams\.get\("organizationSlug"\)/);
  assert.match(directory, /isPlatformAdmin\(user\)/);
  assert.match(directory, /return \{ organizationId: organization\.id \} as const;/, "selected organizations must use the looked-up ID");
});

test("dashboard turns saved email delivery failures into operational alerts", () => {
  const metrics = read("src/app/api/dashboard/metrics/route.ts");
  const dashboard = read("src/components/DashboardMetrics.tsx");
  assert.match(metrics, /notificationStatus/);
  assert.match(metrics, /"failed", "not_configured"/);
  assert.match(metrics, /id: "email-delivery"/);
  assert.match(dashboard, /email delivery issues/);
});

