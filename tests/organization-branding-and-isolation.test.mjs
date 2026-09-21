import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("organization branding is tenant-scoped and editable only through Settings permission", () => {
  const branding = read("src/lib/organization-branding.ts");
  const route = read("src/app/api/organization/branding/route.ts");
  const shell = read("src/components/AppShell.tsx");
  const context = read("src/components/PortalBrandingContext.tsx");
  const layout = read("src/app/layout.tsx");
  const settingsPage = read("src/app/settings/page.tsx");

  assert.match(branding, /eq\(portalSettings\.organizationId, organizationId\)/);
  assert.match(branding, /target: \[portalSettings\.organizationId, portalSettings\.key\]/);
  assert.match(route, /user\.canEditSettings !== true/);
  assert.match(context, /fetch\("\/api\/organization\/branding"/);
  assert.match(context, /portal-branding-updated/);
  assert.match(layout, /getOrganizationBranding\(user\.organizationId\)/);
  assert.match(settingsPage, /OrganizationBrandingEditor/);
  assert.match(branding, /name: "McLink"/);
  assert.match(branding, /DEFAULT_ORGANIZATION_ID/);
  assert.match(branding, /organizations\.name/);
  assert.match(shell, /usePortalBranding/);
});

test("role IDs are allocated from the signed-in organization's roles", () => {
  const rolesRoute = read("src/app/api/roles/route.ts");
  const statusRoute = read("src/app/api/roles/[roleId]/status/route.ts");
  const setupRoute = read("src/app/api/roles/[roleId]/recruitment-setup/route.ts");
  const queries = read("src/lib/internal-recruitment-queries.ts");
  const target = read("src/lib/recruitment-target-portal.ts");

  assert.match(rolesRoute, /listRoles\(undefined, user\.organizationId\)/);
  assert.match(statusRoute, /listRoles\(undefined, user\.organizationId\)/);
  assert.match(setupRoute, /listRoles\(undefined, user\.organizationId\)/);
  assert.match(queries, /eq\(roles\.organizationId, organizationId\.trim\(\)\)/);
  assert.match(target, /listRoles\(undefined, organizationId\)/);
  assert.match(target, /listRoles\(undefined, targetOrg\)/);
});

test("settings PUT rejects keys outside the explicitly editable catalog", () => {
  const route = read("src/app/api/settings/route.ts");
  assert.match(route, /!editableSettingKeys\.has\(setting\.key\)/);
  assert.doesNotMatch(route, /\"Voice_Interview_Duration_Minutes\"/);
});
