import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

test("Role Requests keeps all list state shareable through the URL", () => {
  const rolesList = read("src/components/RolesList.tsx");

  assert.match(rolesList, /const pageSizeOptions = \[10, 25, 50\]/);
  assert.match(rolesList, /pageSize: pageSizeValue\(params\.get\("pageSize"\)\)/);
  assert.match(rolesList, /params\.set\("status", query\.statusFilter\)/);
  assert.match(rolesList, /params\.set\("pageSize", String\(query\.pageSize\)\)/);
  assert.match(rolesList, /router\.replace\(nextQueryString \? `\/roles\?\$\{nextQueryString\}` : "\/roles", \{ scroll: false \}\)/);
});

test("Role Requests uses bounded, debounced filtering and accurate pagination totals", () => {
  const rolesList = read("src/components/RolesList.tsx");
  const api = read("src/app/api/roles/route.ts");
  const pagination = read("src/components/Pagination.tsx");

  assert.match(rolesList, /window\.setTimeout\(\(\) => \{/);
  assert.match(rolesList, /\}, 300\)/);
  assert.match(rolesList, /totalRoles === 1 \? "request" : "requests"/);
  assert.match(rolesList, /pageSizeOptions=\{pageSizeOptions\}/);
  assert.match(rolesList, /onPageSizeChange=\{\(nextPageSize\) => updateQuery/);
  assert.match(pagination, /onPageSizeChange\?: \(pageSize: number\) => void/);
  assert.match(pagination, /Rows per page/);
  assert.match(api, /query\.get\("pageSize"\) \|\| "10"/);
  assert.match(api, /const totalPages = Math\.max\(1, Math\.ceil\(total \/ pageSize\)\)/);
  assert.match(api, /pagination: \{ page, pageSize, total, totalPages \}/);
});

test("Role Requests sorts target dates before slicing the requested page", () => {
  const api = read("src/app/api/roles/route.ts");
  const rolesList = read("src/components/RolesList.tsx");

  assert.match(api, /if \(sort === "target-latest"\) return \(right\.targetHiringDate \|\| "0000-00-00"\)\.localeCompare\(left\.targetHiringDate \|\| "0000-00-00"\)/);
  assert.match(api, /const start = \(page - 1\) \* pageSize/);
  assert.doesNotMatch(rolesList, /sort === "target-latest"[\s\S]*?visibleRoles/);
});

test("Role Requests provides distinct empty, loading, error, and mobile-friendly states", () => {
  const rolesList = read("src/components/RolesList.tsx");
  const styles = read("src/app/globals.css");

  assert.match(rolesList, /No role requests have been submitted yet/);
  assert.match(rolesList, /No role requests match the current filters/);
  assert.match(rolesList, /roles-list-error/);
  assert.match(rolesList, /aria-busy=\{refreshing\}/);
  assert.doesNotMatch(rolesList, /role="link"/);
  assert.match(styles, /\.roles-page \.roles-table tbody tr \{/);
  assert.match(styles, /content: attr\(data-label\)/);
});
