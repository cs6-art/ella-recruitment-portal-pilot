# Ella — in-portal FAQ / help assistant

A small chat widget that answers end-user questions about **how to use the
recruitment portal**. It is deliberately narrow: a portal help bot, not a
candidate-screening AI, and not an agent with data access.

## Architecture (smallest safe version)

```
User (signed-in) ──► HelpBot.tsx widget ──► POST /api/help-bot (server only)
                                               │
                                               ├─ verify session cookie
                                               ├─ per-user rate limit
                                               ├─ retrieveContext(question)  ◄── knowledge.md
                                               │      keyword match → top sections
                                               └─ OpenAI Responses API (server-side key)
                                                      instructions = strict grounding rules
                                                      input        = retrieved sections + question
                                               ◄─ grounded answer (or "I don't know")
```

No vector database. The knowledge base is a single Markdown file (~2k words);
retrieval is plain keyword-overlap scoring over its `##` sections
(`src/lib/help-bot/knowledge.ts`). Two framing sections (portal overview, access
model) are always included; up to four scored sections are added.

## AI provider

- **Provider:** OpenAI (Responses API) via the official `openai` npm package
  (added to `package.json`).
- The portal had **no reusable in-app LLM integration** before this — AI CV
  screening and voice interviews run in **n8n** (which uses its own OpenAI
  credential, not available to the Next.js app). So a dedicated key is required.
- The retrieval/grounding layer (`src/lib/help-bot/*`) is provider-independent;
  only the `client.responses.create` call in `src/app/api/help-bot/route.ts` is
  OpenAI-specific.

## Environment variables

| Variable           | Required        | Default       | Notes |
| ------------------ | --------------- | ------------- | ----- |
| `OPENAI_API_KEY`   | For answers     | —             | Server-only. Read only in `src/app/api/help-bot/route.ts`; never exposed to the browser and **not** a `NEXT_PUBLIC_` var. When unset the widget remains hidden and no API call is made. |
| `HELP_BOT_MODEL`   | No              | `gpt-4o-mini` | Low-cost model, sufficient for grounded FAQ answers. Override (e.g. `gpt-4.1-mini`) if desired. |
| `HELP_BOT_ENABLED` | No              | `true`        | Explicit kill switch. The widget is also hidden automatically when `OPENAI_API_KEY` is missing. |

### Enabled vs configured

`GET /api/help-bot` returns `{ enabled, configured }`:

- `enabled` — `HELP_BOT_ENABLED !== "false" && Boolean(OPENAI_API_KEY)`. Controls whether the launcher renders at all; missing provider configuration keeps it hidden.
- `configured` — `enabled && Boolean(OPENAI_API_KEY)`. Controls whether questions can be sent.

| `HELP_BOT_ENABLED` | `OPENAI_API_KEY` | Launcher | Panel | Input | `POST` |
| --- | --- | --- | --- | --- | --- |
| `false` | any | hidden | — | — | 503 "not available" |
| unset / `true` | unset | hidden | — | — | 503, no OpenAI call |
| unset / `true` | set | visible | opens normally | enabled | grounded answer |

## Knowledge source

- **File:** `src/lib/help-bot/knowledge.md` — the *only* approved source.
- Authored from `docs/McLink-Recruitment-Portal-User-Manual.html`,
  `docs/WORKING-RECRUITMENT-WORKFLOW.md`, and `docs/access-control-matrix.md`,
  rewritten into plain user-facing FAQ answers. Internal identifiers (webhook
  URLs, workflow IDs, spreadsheet IDs, credential names) are intentionally
  excluded.
- To extend the bot's coverage, edit this Markdown file — no code change needed.
  `next.config.mjs` (`outputFileTracingIncludes`) ships it with the serverless
  bundle.

## How grounding works

1. `retrieveContext()` selects the relevant `##` sections for the question.
2. The **system prompt** (`src/lib/help-bot/prompt.ts`) tells the model to answer
   only from the supplied knowledge, to refuse (say it doesn't know + point to
   HR) when the answer isn't present, to never reveal internal system details,
   and that it has no access to live data or actions.
3. The **user prompt** embeds the retrieved sections and the question. When no
   section scored a keyword match, the prompt explicitly instructs the fallback
   "I don't know" behaviour.
4. `max_output_tokens` is capped at 700; conversation history is limited to the
   last 6 messages, 1200 chars each. The system prompt also blocks prompt
   injection and requests for the system prompt, secrets, internal IDs, or
   configuration.

## Security

- **API key:** server-side only, read from `process.env` inside the route
  handler. Not referenced in any client component or `NEXT_PUBLIC_` var.
- **Auth:** the route rejects unauthenticated requests (401). Only signed-in
  portal users can call it.
- **Rate limiting:** `consumeRateLimit` keyed by `help-bot:<email>:<client-ip>`,
  20 requests / 5 minutes → HTTP 429. Reuses the same process-local limiter as
  the rest of the portal (`src/lib/rate-limit.ts`); a shared edge limit should
  back it in multi-instance production, same caveat as every other route.
- **No confidential data:** the bot receives only the static knowledge file and
  the user's typed question. It has no access to applicant/resume records,
  scores, calendars, credit balances, user lists, Google Sheets, or n8n, and it
  cannot perform actions.
- **No record leakage:** because it has no data connection, it cannot surface
  records a user could not otherwise see.
- Upstream OpenAI errors are caught and returned as generic 502/429 messages;
  details go to server logs only.

## UI

- **Launcher:** fixed bottom-right pill button ("Ella", collapses to an icon
  on mobile), `z-index: 60`.
- **Panel:** 400×560 popover on desktop; full-width bottom sheet under 520px.
  Header "Ella / Portal guide assistant", greeting message, 8 suggested
  starter questions, message list, animated typing indicator (loading state),
  inline error banner (error state), textarea composer (Enter to send,
  Shift+Enter for newline, 600-char cap), and a persistent disclaimer line.
- Uses the portal design tokens (`--navy`, `--blue`, `--radius-*`,
  `--elevation-*`) and the shared `UiIcon` set (new `help` and `send` glyphs).
- Mounted once in `AppShell.tsx`, so it appears on every authenticated page for
  every role (including view-only Management and HOD).
- Honours `prefers-reduced-motion`.

## Files

Created:
- `src/lib/help-bot/knowledge.md` — approved FAQ knowledge base
- `src/lib/help-bot/knowledge.ts` — section parser + keyword retrieval
- `src/lib/help-bot/prompt.ts` — system prompt, starter questions, user-prompt builder
- `src/app/api/help-bot/route.ts` — server route (auth, rate limit, retrieval, LLM call)
- `src/components/HelpBot.tsx` — chat widget
- `src/components/HelpBot.module.css` — widget styles
- `tests/help-bot-knowledge.test.mjs` — retrieval/grounding unit tests
- `docs/ELLA-HELP-BOT.md` — this file

Changed:
- `src/components/AppShell.tsx` — mount `<HelpBot />`
- `src/components/UiIcon.tsx` — add `help` and `send` icons
- `next.config.mjs` — trace `knowledge.md` into the route bundle
- `.env.example` — document the three env vars
- `package.json` / `package-lock.json` — add `openai`
- `CHANGELOG.md`

## Manual setup required

1. With no `OPENAI_API_KEY`, the widget stays hidden and cannot submit questions.
2. Create an OpenAI API key and set `OPENAI_API_KEY` in the deployment
   environment (and `.env.local` for local dev). The same deployment becomes
   functional automatically once the key is present — no code change or rebuild
   of the app logic is required (a redeploy to pick up the new env var is).
3. (Optional) set `HELP_BOT_MODEL` if you don't want the `gpt-4o-mini` default.
4. Verify by signing in and opening the bottom-right "Ella" button.
