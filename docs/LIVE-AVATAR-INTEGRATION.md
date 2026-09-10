# LiveAvatar ("Meet Ella now") integration

The public apply page (`/apply/[roleId]`) can offer an independent, resume-led
"Meet Ella now" screening step powered by
[LiveAvatar](https://www.liveavatar.com) (HeyGen). It is additive: nothing
about the existing scheduled phone-call interview (Vapi, triggered by n8n
after resume screening) changes.

## How it works

1. The candidate selects a resume and clicks **Analyze resume & prepare Ella**.
   `POST /api/live-avatar/prepare` extracts the resume on the server and
   generates a concise role-specific resume summary and one screening question.
   The original resume is not sent to LiveAvatar.
2. The apply page is a server component. If `LIVEAVATAR_API_KEY`,
   `LIVEAVATAR_AVATAR_ID`, and `LIVEAVATAR_VOICE_AGENT_ID` are all set, it
   enables the live screening step inside the application form. Otherwise the
   step is simply not rendered — there is no broken state.
3. When the candidate clicks **Start with Ella**, the
   browser calls `POST /api/live-avatar/session` with the role id, candidate
   name, and the server-generated summary and question
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
5. When the candidate finishes, `POST /api/live-avatar/evaluate` retrieves the
   session transcript from LiveAvatar server-to-server and produces a concise
   response summary, strengths, follow-up areas, and a non-binding response
   signal for the results panel.

## Customizing by Job Description and role

This is the part that makes Ella's greeting and screening questions
specific to the role the candidate is looking at, instead of a generic
script:

- Every session request sends `dynamic_variables: { role_title,
  job_description, candidate_name, resume_summary, screening_question }`.
  The original resume is not sent to LiveAvatar. The question is generated
  from the extracted resume and published role context; an approved role
  question is preserved when one exists.
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

## Limitations / follow-ups

- The live-avatar result is a candidate-facing screening aid and is not a
  replacement for the HR-reviewed Vapi phone interview or the existing
  `High_Match_Profile` pipeline. Persisting the result into the HR sheets can
  be added as a separate, explicitly configured n8n handoff.
- There is no per-role avatar picker in Recruitment Setup; every role uses
  the same avatar and voice agent, customized only by role title and job
  description via dynamic variables.
- `max_session_duration` is capped at 900 seconds (15 minutes) server-side
  to bound LiveAvatar credit usage from an abandoned tab.
