# Changelog

All notable changes to the McLink Recruitment Portal are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Ella Help (in-portal FAQ assistant).** A non-intrusive "Ella Help" chat
  widget (bottom-right, on every signed-in page) answers questions about how to
  use the portal. Answers are grounded in an approved Markdown knowledge base
  (`src/lib/help-bot/knowledge.md`) via lightweight keyword retrieval — no vector
  database. The LLM call runs server-side only (`/api/help-bot`, OpenAI Responses
  API, `OPENAI_API_KEY`, default model `gpt-4o-mini`), is rate-limited per user,
  and the bot is instructed to say it does not know rather than invent answers
  and to refuse prompt-injection / system-prompt / secret / config requests. It
  has no access to applicant records, resumes, scores, calendars, credit
  balances, Sheets, or n8n. The widget can deploy before `OPENAI_API_KEY` is
  set — it stays visible and opens to a "being configured" notice with the
  input disabled and no API call, then becomes functional once the key is
  added. `HELP_BOT_ENABLED=false` fully hides it. See `docs/ELLA-HELP-BOT.md`.

## [1.1.0] - 2026-08-12

### Added
- **HOD Google Calendar integration.** HODs connect their own Google Calendar
  from the dashboard (OAuth2, per-user, encrypted tokens at rest). When a
  candidate books a final interview, the event is created automatically on
  the role's HOD calendar with the candidate as an attendee.
- **Manual resume upload.** Candidates can upload a PDF or DOCX resume
  instead of pasting text; text is extracted server-side (`mammoth`,
  `pdf-parse`) and stored privately, never publicly served.
- **Booking rescheduling.** Candidates can change an already-booked
  interview slot via their existing booking link.
- **Google Sheets read caching.** Short-TTL (20s) cache with request
  coalescing, minimum-interval throttling, exponential backoff on quota
  errors, and stale-cache fallback so a Sheets 429 degrades gracefully
  instead of failing the request. Applied across `applicant-workflow.ts`,
  `google-sheets.ts`, `candidate-applications.ts`, and `calendar-tokens.ts`.
  Fixes `reserveBooking()` alone reading the same tab up to three times per
  call.
- `CHANGELOG.md` (this file).

### Changed
- **Recruitment Setup UI simplified for HR.** The screen HR uses to
  configure Ella's interview script now defaults to a plain-language,
  field-based view — no `{{curly_brace}}` template syntax visible unless HR
  explicitly opens "Advanced: edit full script". Interview questions dropped
  their forced category labels ("Role experience", "Technical or quality
  expertise", etc.) in favor of simple "Question 1"–"Question 5" inputs, so
  HR isn't boxed into predefined topics.
- **Script preview now uses a sample candidate.** Previously the preview
  still showed raw `{{candidate_name}}` / `{{email}}` / `{{match_score}}`
  tags (those are only resolved per-candidate at call time). The preview now
  substitutes a realistic example candidate so HR reads plain text.
- Synced the portal's built-in Vapi system prompt template with the
  production-refined version actually running live calls (richer
  language-switching handling, conversational recovery, gatekeeper phrasing).
- Candidates now re-confirm their preferred mobile number at booking time,
  not only at initial application.

### Fixed
- `npm run lint` (was passing an invalid directory argument under Next.js 16).
- `Voice_Call_Queue` was never enqueued by the portal's own booking route —
  only the legacy n8n-hosted booking API wrote it, so bookings made directly
  through the portal never triggered an AI call. Fixed in
  `reserveBooking()`.
- Stale-read race in the n8n booking-invitation workflow could silently
  regenerate a token and re-send an invitation for a slot the candidate had
  already booked, reverting `Booking_Token_Status`/`Voice_Interview_Booking_Status`.
  Added a guard that self-heals instead.

## [1.0.0] - 2026-08-11

Initial commit. Full Version 2 Phase 1–2 recruitment workflow: role
request → HR/Management approval → recruitment setup → publishing →
candidate application → AI resume screening → HR decision → AI voice
interview booking and dispatch → HR voice decision → final interview
booking. Google Sheets-backed persistence, n8n workflow orchestration,
session-based RBAC.
