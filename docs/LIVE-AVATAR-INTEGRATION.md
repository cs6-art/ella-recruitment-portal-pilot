# LiveAvatar ("Meet Ella now") integration

The public apply page (`/apply/[roleId]`) can show an optional "Meet Ella
now" card that starts a live, face-to-face video interview with Ella right
in the browser, powered by [LiveAvatar](https://www.liveavatar.com) (HeyGen).
It is additive: nothing about the existing scheduled phone-call interview
(Vapi, triggered by n8n after resume screening) changes. A candidate can try
Ella's live video interview, ignore it, or do both — none of it blocks
submitting the application form below it.

## How it works

1. The apply page is a server component. If `LIVEAVATAR_API_KEY`,
   `LIVEAVATAR_AVATAR_ID`, and `LIVEAVATAR_VOICE_AGENT_ID` are all set, it
   renders `<LiveAvatarInterview roleId roleTitle />`
   (`src/components/LiveAvatarInterview.tsx`). Otherwise the card is simply
   not rendered — there is no broken state.
2. When the candidate clicks **Start live interview with Ella**, the
   browser calls `POST /api/live-avatar/session` with only `{ roleId }`
   (`src/app/api/live-avatar/session/route.ts`).
3. That route re-loads the role from the spreadsheet itself (it never
   trusts a job description or title from the client), confirms the role is
   actually published for intake, and calls LiveAvatar's
   `POST /v1/sessions/token` server-side with the secret API key
   (`src/lib/live-avatar.ts`). Only the resulting short-lived
   `session_token` is returned to the browser — the API key never reaches
   the client.
4. The browser loads `@heygen/liveavatar-web-sdk` on demand (not in the main
   bundle) and starts a `LiveAvatarSession` with that token, rendering
   Ella's video and streaming the candidate's microphone.

## Customizing by Job Description and role

This is the part that makes Ella's greeting and screening questions
specific to the role the candidate is looking at, instead of a generic
script:

- Every session request sends `dynamic_variables: { role_title,
  job_description }`, taken from that role's published `Job Title` and
  `Job Description` (the same fields already shown above the card on the
  apply page — nothing confidential like Screening Criteria or the internal
  Interview Questions is sent).
- In the LiveAvatar dashboard, **Voice Agents → McLink AI Interviewer**
  points at a **Context** (also named "McLink AI Interviewer") whose
  Opening Intro and Full Prompt use `${role_title}` and `${job_description}`
  placeholders. LiveAvatar substitutes the dynamic variables into those
  placeholders for every session.
- To change *what Ella says or asks* — tone, flow, follow-up behavior — edit
  that Context's prompt in the LiveAvatar dashboard
  (app.liveavatar.com → Contexts → McLink AI Interviewer). Changes apply to
  new sessions immediately; nothing needs to be redeployed.
- To change *how Ella looks or sounds*, update `LIVEAVATAR_AVATAR_ID` /
  the voice agent's voice in the dashboard.

## Required environment variables

See `.env.example` for the full list and comments:

- `LIVEAVATAR_API_KEY` — secret, server-only. Create one at
  app.liveavatar.com → Developers → API Key. A key named
  "Ella AI Website - Apply Page Interview" already exists for this feature —
  reuse it, or revoke it and create a fresh one.
- `LIVEAVATAR_AVATAR_ID` — defaults to `65f9e3c9-d48b-4118-b73a-4ae2e3cbb8f0`
  ("June HR" preset avatar), the avatar already selected for Ella.
- `LIVEAVATAR_VOICE_AGENT_ID` — defaults to
  `c718a07d-f8eb-4682-8b70-1c1bf1f48291` ("McLink AI Interviewer").
- `LIVEAVATAR_IS_SANDBOX` — set to `true` in non-production environments to
  avoid consuming LiveAvatar credits while testing.
- `LIVEAVATAR_LANGUAGE` — optional, defaults to `en`.

Add these in Vercel under Project Settings → Environment Variables for each
environment (Production / Preview) that should offer the live interview.

## Limitations / follow-ups (out of scope for this change)

- The live avatar conversation is not (yet) recorded, transcribed, or
  scored back into `Role_Requests` / the candidate pipeline the way the
  Vapi phone interview is. It's a candidate-facing engagement option today,
  not a replacement input into the AI screening decision.
- There is no per-role avatar picker in Recruitment Setup; every role uses
  the same avatar and voice agent, customized only by role title and job
  description via dynamic variables.
- `max_session_duration` is capped at 900 seconds (15 minutes) server-side
  to bound LiveAvatar credit usage from an abandoned tab.

- `max_session_duration` is capped at 900 seconds (15 minutes) server-side
-   to bound LiveAvatar credit usage from an abandoned tab.


