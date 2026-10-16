# Task: (2) 48-hour voice booking window, (3) standalone HR notes per applicant

You are working in the Smile recruitment portal (Next.js, this repo). Read `AGENTS.md` first. This Next.js version differs from what you know, so check `node_modules/next/dist/docs/` before you write route handlers or pages. Match the surrounding code style (dense one-line JSX, `text()`/`field()` helpers, short comments that explain why).

Two backends exist side by side. The Postgres target (`isPostgresRecruitmentTarget()` → `src/lib/recruitment-target-portal.ts`) is the main path. The Google Sheets legacy path is in `src/lib/applicant-workflow.ts`. Implement both features on the Postgres path. On the Sheets path, do the minimum that keeps behaviour consistent, and say in your report what you left out.

---

## Feature 2: AI voice interview booking is bookable for exactly 48 hours after the link is sent

### Goal
A voice booking link works for **exactly 48 hours from the moment it was sent**. Within that period the candidate sees only interview times that start after now and no later than `sent_at + 48h`. After 48 hours the link is expired. Face-to-face (`final`) bookings stay **unchanged**.

### Rules
- Anchor: Postgres `booking_tokens.created_at` of the voice token. Sheets path: add `Booking_Token_Issued_At`, written in `sendVoiceBookingInvitation`.
- Export `VOICE_BOOKING_WINDOW_HOURS = 48` and a pure helper `isWithinVoiceBookingWindow(slotStartInstant, issuedAt)` in `src/lib/interview-availability-rules.ts` for unit tests.
- Keep every existing filter (future time, target hiring date, Vapi concurrency cap, blocked/expired).
- Enforce on the server when reserving (`targetReserveBooking` and the Sheets path), not only in the list.
- Set the voice token `expiresAt = sent_at + 48h` everywhere a voice token is created (first invite, re-send, internal/n8n routes). Leave `Booking_Link_Expiry_Days` for final links.
- No-show reschedule: restart the 48h window when a new link/booking becomes available again.
- UI: one line under "Select a Date": "Times are available for 48 hours from when this link was sent." Empty window shows the existing no-availability state.
- Update copy that says "7 days" for voice links (email templates, help-bot knowledge, manual, smile-tips).
- Tests: helper boundaries (just inside/outside 48h), reserve rejects out-of-window, final unaffected.

---

## Feature 3: Standalone HR notes on every applicant

### Goal
The applicant detail page currently only has the optional "Note" inside the HR decision panel, which saves only together with Approve/Reject/Send interview. HR needs to **just write a note** with no decision button. Notes are HR-only: never shown to candidates or included in emails.

### Design
- Add an "HR Notes" card on `src/app/applicants/[applicationId]/page.tsx` (a client component, e.g. `ApplicantNotes.tsx`): textarea, character counter, "Add note" button, then the list of notes newest first (author, relative time with exact time on hover, "edited" marker, edit/delete where allowed, delete confirmation). Empty state: "No notes yet. Notes are visible only to your HR team." Leave the decision panel as it is.
- Scope notes to the application, new table `application_notes` (migration after the current highest, soft delete, `organization_id` filter on every query), Drizzle schema in `src/db/schema-recruitment.ts`.
- API: `src/app/api/applicants/[applicationId]/notes/route.ts` (GET, POST) and `[noteId]/route.ts` (PATCH, DELETE). Auth via `getActiveSessionUser` + `access-control.ts`; author/owner/admin can edit or delete; rate-limit writes; trim, non-empty, max 5000, plain text. Cross-org returns 404. Sample candidates still allow notes. Sheets backend returns a clear "requires database backend" response.
- Update help-bot knowledge and manual; delete/anonymise notes in erasure flows if any.
- Tests: CRUD, author rule, cross-org 404, empty/oversize rejected, soft-deleted hidden, notes absent from public booking responses.

---

## Done means
1. `npx tsc --noEmit` and the lint script pass.
2. The relevant tests pass. Use `--test-concurrency=4`, as the HR automation tests need.
3. A short report covering the files changed, the migration number (it must be applied before deploy), any Sheets-path gaps, and anything you could not verify in a real browser.
4. **Do not commit, push, apply migrations to any real database, or change n8n workflows.** Leave the changes uncommitted for review.
