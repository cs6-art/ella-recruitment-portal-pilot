# LiveAvatar candidate invitation integration

The public apply page remains a normal candidate application form. After the
resume is analyzed and HR approves the candidate, the candidate receives one
email with two secure choices powered by [LiveAvatar](https://www.liveavatar.com)
(HeyGen): **Schedule a call** or **Interview with our Avatar now**.

## How it works

1. The candidate submits a resume through the normal public application page.
2. The portal stores the resume analysis and generated screening question.
3. HR approves the resume. The portal creates two separate expiring tokens:
   a phone-call booking token and an avatar interview token.
4. The candidate email renders two buttons. Choosing the call opens the normal
   `/book/voice/...` flow. Choosing Ella opens `/avatar/...`.
5. The avatar link is claimed atomically when the candidate starts. It is
   single-use, expires automatically, and the unused call link is revoked when
   Ella starts.
6. Ella receives the stored role context, resume summary, and screening
   question. The browser loads `@heygen/liveavatar-web-sdk` on demand and
   streams the candidate's microphone to the avatar session.
7. When the candidate finishes, the portal retrieves the transcript from
   LiveAvatar server-to-server, evaluates the response, stores the result for
   HR review, and shows the candidate a results summary.

## Customizing by Job Description and role

This is the part that makes Ella's greeting and screening questions
specific to the role the candidate is looking at, instead of a generic
script:

- Every candidate session request sends `dynamic_variables: { role_title,
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

- The live-avatar result is an HR-reviewed screening aid and is not an
  automated hiring decision. In the Postgres target it is stored in
  `voice_interview_results` and moves the application to `voice_review_pending`.
- There is no per-role avatar picker in Recruitment Setup; every role uses
  the same avatar and voice agent, customized only by role title and job
  description via dynamic variables.
- `max_session_duration` is capped at the configured provider-safe limit
  server-side to bound LiveAvatar credit usage from an abandoned tab.
