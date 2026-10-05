# Google OAuth verification: resubmission pack

## 1. Reply email (send as a reply to the Google Third Party Data Safety Team thread)

Subject: Re: OAuth verification, Smile Recruitment Portal: updated privacy policy, AI disclosures and new demo video

Hello Google Developer Team,

Thank you for your review. We have made the following updates.

**Updated privacy policy:** https://smile.mclinkgroup.com/privacy
It now includes a "How we protect Google user data" section (encryption in transit and at rest, least-privilege scopes, access control, secrets handling, retention, incident response) and a "Use of AI with Google user data" section.

**Third-party AI integrations that can receive Google user data**

| Provider | Plan / tier | Endpoint | Data received | Training |
|---|---|---|---|---|
| OpenAI | API, paid pay-as-you-go (business API terms) | Chat Completions via api.openai.com, model gpt-5-mini | Text of resume files the user selects with the Google Picker (drive.file); interview transcripts | Not used for training under OpenAI API terms. No opt-in to data sharing. |

Other providers (not receiving Google user data): LiveAvatar (live interview video/audio), tier: <FILL IN PLAN>.

**Aggregators / gateways / model hubs:** None. We call OpenAI directly. <CONFIRM>

**Self-hosted or offline models:** None.

**Limited Use:** Google user data is used only to provide the user-facing features, is not sold, is not used for advertising, and is never used to create, train or improve generalized AI/ML models. Raw or derived data is not transferred to any service that trains on it.

**Scopes:** The scopes in the demo video match those configured in Cloud Console exactly: userinfo.email, drive.file, calendar.events, calendar.freebusy. The portal does not request any Google Sheets scope from users; its recruitment records are written by our own service account to sheets we own.

**Demo video:** <LINK>
**Test credentials and steps:** see below.

Test account: <EMAIL> / <PASSWORD> (no phone or card verification required)

Steps:
1. Go to https://smile.mclinkgroup.com and sign in with the test account.
2. Open Resume Screening, then Bulk Resume Screening.
3. Click Connect Google Drive and approve the consent screen.
4. Click Choose from Google Drive, select one or more resume files, and confirm.
5. Start screening and view the scored results.
6. Open Calendar settings, click Connect Google Calendar, approve, and create an interview event.
7. Disconnect Google from the same settings page.

Best regards,
<NAME>, MPS Solutions Pte Ltd

---

## 2. Demo video: what to change and how to record it

Google rejected the old video because the consent screen was not fully visible and the scopes did not clearly match. Re-record it from scratch.

### Before recording
1. **Use a separate Google Cloud project** (or a staging deployment of this app) for the recording, so unverified scopes are not pushed to production users and your user cap is not consumed. The production project stays "In Production".
2. In that recording project, set the OAuth client scopes to exactly the list submitted for verification: userinfo.email, drive.file, calendar.events, calendar.freebusy. Do not list `spreadsheets`: it is used only by the server's service account, never in a user consent flow. Compare the Cloud Console "Data Access" page against the scope constants in `src/lib/google-drive.ts`, `google-calendar.ts` and `recording-drive-oauth.ts`. Remove any scope in one place that is not in the other.
3. Add the recording Google account as a test user. Use an account with a few sample resume files in its Drive.
4. Create the test portal account for reviewers (email + password, no phone/card step). Test it from a fresh browser profile.
5. Set browser language to English, zoom to 100%, close other tabs, and hide bookmarks and personal data. Record at 1080p with narration or captions.
6. Keep the address bar visible so the URL and the OAuth `client_id` are readable.

### Scenes (record in this order, one continuous take if possible)
1. **Intro (10 s):** Say the app name, the company, the URL and the Cloud project/client ID. Show the privacy policy page and scroll to the new "How we protect Google user data" and "Use of AI with Google user data" sections.
2. **Sign in** to the portal with the test account.
3. **Drive consent flow (the key scene):**
   - Click Connect Google Drive.
   - On the Google consent screen, show the app name and the address bar with `client_id` visible.
   - **Click "Show all services"/expand so every scope is open and readable.** Pause 5 seconds, narrate each scope. Do not let it be cropped or scrolled away.
   - Click Continue/Allow.
4. **Use the Drive data:** open the Google Picker, pick resumes, run screening, and show the AI-generated result. Narrate that the text goes to OpenAI only to score the resume and is not used for training.
5. **Calendar consent flow:** repeat the same fully-expanded consent screen for calendar.events and calendar.freebusy, then create an interview event and show it in Google Calendar.
6. **Sheets (no user scope):** say that recruitment records are written by the portal's own service account to sheets McLink owns, so no user is asked for Sheets access. Do not show a Sheets consent screen, because there is none.
7. **Recording storage (drive.file):** show an interview recording being saved to Drive and opened from the review page.
8. **Disconnect:** disconnect Google in the portal and show the access removed at myaccount.google.com/permissions.
9. **Outro:** state again that Google data is never used to train AI models.

### What must be different from the rejected video
- Consent screen: scopes fully expanded and readable (the first reason for rejection).
- Scopes shown on screen equal scopes in Cloud Console (second reason).
- Recorded in a separate project/staging, not production (third reason).
- Include the AI step so reviewers see how Drive data is used.
- Upload to YouTube as Unlisted, and put the link in the Cloud Console verification form and the email.

### After recording
1. Cloud Console, Verification Center: paste the new video link, test credentials and steps, and the privacy policy URL `https://smile.mclinkgroup.com/privacy`. Resubmit.
2. Send the reply email above in the same thread.
