# Testing guide

Run the automated checks from the project root:

```text
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
npm.cmd run test:browser
```

`test:browser` uses Playwright Chromium, starts a local Next.js server, and
tests signed fixture sessions for creator and settings-administrator users at
1440px, 1024px, 768px, and 390px. It covers the login page, dashboard, role
creation access, protected-page redirects, settings access, logout, overflow,
and responsive layout. It does not substitute for live Google Sheets, n8n,
Gmail, or real Google Workspace UAT.

Manual smoke test:

1. Confirm a logged-out visitor is redirected from `/dashboard`, `/roles`, and
   `/settings`.
2. Log in as an inactive or unlisted directory user and confirm access is
   denied.
3. Log in as a creator-only user. Confirm `/roles` is titled `My Role
   Requests`, the list and metrics contain only that user's requests, and a
   direct URL to another role returns access denied.
4. Log in as a reviewer or approver. Confirm the title is `All Role Requests`
   and organization-wide rows and metrics are visible.
5. Exercise status actions with comments, refresh the page, repeat the same
   action request, and confirm the second request is an idempotent replay.
6. Approve a role, complete Recruitment Setup with the three required fields,
   valid optional URLs, and multiple posting channels. Confirm the updated-by
   and updated-at values and history entry.
7. Repeat a setup request after a network interruption using the same browser
   retry. Confirm the same `actionRequestId` is used.
8. Test notification responses `sent`, `pending`, `failed`, and
   `not_configured`; workflow success must remain success in all four cases.
9. In Recruitment Setup, enter structured screening fields, use Regenerate
   from fields, manually edit the prompt, and confirm the manual prompt is
   preserved on save.
10. Log in as a settings editor, read and update a non-secret setting, and
   confirm `Updated_At` and `Updated_By` are server-generated.
## Recruitment Setup stage validation

Verify that Save Draft accepts the three draft fields while higher-stage
actions identify missing AI, interview, posting, salary, experience, and
conditional HOD or license requirements. Verify that only Ready for Publishing
enables Publish Role and that a draft never changes a role to Job Posted.
