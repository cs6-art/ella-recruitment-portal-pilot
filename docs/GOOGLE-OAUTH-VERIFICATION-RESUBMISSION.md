# Google OAuth verification: scopes, video script and resubmission

Updated 2026-10-08. Shared copy: https://claude.ai/code/artifact/8cce01d3-40f8-4f64-9c38-38d9018f5271 (older version; this file is current).

## Why the last submission was rejected

Google rejected the submission because the scopes the app requested did not match the scopes declared in Cloud Console. The app used to request `drive.readonly`, a **restricted** Drive scope. It now requests only the scopes below. They are defined in one place, `src/lib/google-oauth-scopes.ts`, and a regression test (`tests/google-oauth-scopes.test.mjs`) fails if any restricted Drive scope comes back.

## User OAuth scopes (shown on the consent screen)

These are the only scopes any user is asked for. Every consent URL is built from `USER_OAUTH_SCOPES`, with `include_granted_scopes: false` so earlier grants are never folded into a new token.

| Scope | Requested by | Used for | Google classification |
| --- | --- | --- | --- |
| `https://www.googleapis.com/auth/drive.file` | Bulk Resume Screening → Connect Google Drive; Settings → Google Drive for Live Avatar recordings | Opening only the resumes the user picks in the Google Picker; saving recordings into the folder the user picks | Non-sensitive (Google Drive API scope table) |
| `https://www.googleapis.com/auth/userinfo.email` | Every Google connect | Confirming the token belongs to the account that started the connection | Read the label on the Data Access page |
| `https://www.googleapis.com/auth/calendar.events.freebusy` | Settings → Connect Google Calendar | Checking interview availability (`freebusy.query`) only | Read the label on the Data Access page |
| `https://www.googleapis.com/auth/calendar.events` | Settings → Connect Google Calendar | Creating, moving and cancelling the interview event (`events.insert`, `events.patch`, `events.delete`) only | Read the label on the Data Access page |

The portal never reads calendar event contents. The old fallbacks that listed events (for availability when `calendar.events.freebusy` was missing, and to guess the account owner) have been removed. A calendar connection without both calendar scopes must reconnect.

Not requested from users: `drive.readonly`, `drive.metadata.readonly`, full `drive`, `spreadsheets`, or any other Google scope.

## Service-account scopes (never shown to users)

The server also uses its own Google service account. Its scopes are not part of the consent screen and are not declared on the Data Access page, but they follow the same rule: no restricted Drive scope.

| Scope | Used for |
| --- | --- |
| `drive.file` | Storing uploaded and imported resumes. The service account creates its own **Smile Resume Storage** folder inside the configured Shared Drive and stores resumes there, so it reaches only the folder and files it created. It also plays back recordings that it saved before organizations connected their own Drive. |
| `spreadsheets` | Reading and writing the portal's own records in spreadsheets McLink owns. |

The service account previously held `drive.readonly`, later `drive.metadata.readonly`. Both are restricted. They were only needed for one pre-upload check that read the Shared Drive root, which `drive.file` cannot see. That check now targets the app-owned folder instead, so neither scope is used anywhere in production code.

## What Google Auth Platform → Data Access must contain

Exactly these four scopes, and nothing else:

1. `https://www.googleapis.com/auth/userinfo.email`
2. `https://www.googleapis.com/auth/drive.file`
3. `https://www.googleapis.com/auth/calendar.events`
4. `https://www.googleapis.com/auth/calendar.events.freebusy`

Remove `drive.readonly`, `drive.metadata.readonly`, `drive`, `spreadsheets` and any other scope if listed, then save. The Data Access page shows each scope's tier (non-sensitive, sensitive or restricted). Expect no restricted scope. If one appears, stop and check before submitting.

## Before you record

Allow about 20 minutes. Tick each item off before you press record.

- [ ] **Deploy this change to production first.** Until it is live, production still requests the old scopes.
- [ ] **Verify resume storage.** Run `node --env-file=<production env file> tools/scripts/verify-resume-storage-drive-file.mjs`. Every line must say PASS. The service account must be a Content manager of the Shared Drive.
- [ ] **Use the project being verified.** Record on `smile.mclinkgroup.com` (production), so the `client_id` in the video is the one under review.
- [ ] **Data Access page** matches the four scopes above exactly.
- [ ] **Google Picker set-up.** `GOOGLE_PICKER_API_KEY` and `GOOGLE_CLOUD_PROJECT_NUMBER` are set in production. The API key is restricted to the Google Picker API and the production origin. The Google Drive API and Google Picker API are enabled in the project.
- [ ] **Branding page.** App name, logo, home page `https://smile.mclinkgroup.com`, privacy URL `https://smile.mclinkgroup.com/privacy` and authorized domain `mclinkgroup.com` are correct.
- [ ] **Demo Google account.** Use a demo Gmail account, not a personal one. Put 2 or 3 sample PDF resumes with made-up names in its Drive, plus one unrelated file, and create an empty folder called `Smile Interview Recordings`.
- [ ] **Clear old access.** At https://myaccount.google.com/permissions, remove "Smile" if listed, so every consent screen appears in full.
- [ ] **HR portal account.** It can manage Settings, because only a settings administrator can connect Calendar.
- [ ] **Organization set-up.** One active role with Face-to-Face Interviews on, and at least one finished Live Avatar interview with a recording.
- [ ] **Disconnect in the portal.** Disconnect any existing Google Drive, Calendar and recording Drive connection.
- [ ] **Reviewer login.** A separate email and password account with no phone or card step, tested in a private window.
- [ ] **Screen.** Clean Chrome profile, 100% zoom, 1920×1080, English. Close other tabs, mute notifications, hide bookmarks. Keep the address bar visible throughout.

## Scenes

Target length is 6 to 8 minutes. Record in this order, in one take if you can.

1. **Intro (15 s).** Show `https://smile.mclinkgroup.com` with the address bar visible.
   - Say: "This is the Smile Recruitment Portal, operated by MPS Solutions Pte Ltd. This video shows how the app requests and uses Google user data."
   - Show the OAuth client ID on screen, either in the consent-screen address bar or in a caption.
2. **Privacy policy (30 s).** Open `/privacy` and scroll to "Part 2: Google user data". Pause on "What we access and why", "How we protect Google user data" and "Use of AI with Google user data".
3. **Sign in (10 s).** Sign in to the portal with the HR account.
4. **Google Drive for resumes (about 2 min). This is the most important scene.**
   - Go to Resume Screening → Bulk Resume Screening and choose the role.
   - Click **Connect Google Drive** and choose the demo Google account.
   - On the consent screen, make sure the address bar shows `client_id=...`. Expand every permission so each one is fully readable. Hold still for 5 to 8 seconds.
   - Say: "drive.file lets the portal open only the files the user picks in the Google file chooser. userinfo.email confirms which account is connected."
   - Click **Continue**. The portal shows the connected email.
   - Click **Choose from Google Drive**, pick the sample resumes, and confirm. Point out that the unrelated file is not imported.
   - Start screening. Show the files in the queue with Google Drive as the source, then show the scored result.
5. **Google Calendar (about 1.5 min).**
   - Go to Settings → Google Calendar and click **Connect Google Calendar**. Choose the demo account.
   - Expand every permission and hold for 5 to 8 seconds with `client_id` visible.
   - Say: "calendar.events.freebusy checks when the recruiter is free. calendar.events creates, moves and cancels the interview event. The portal does not read other events."
   - Schedule a face-to-face interview, or book a slot from the candidate's booking link to show the availability check.
   - Open Google Calendar in a new tab and show the event. Reschedule it in the portal and show the event moved.
6. **Google Drive for interview recordings (about 1 min).**
   - Go to Settings → "Google Drive for Live Avatar recordings" and click **Connect Google Drive**.
   - Expand every permission and hold. It shows the same `drive.file` and `userinfo.email` scopes.
   - Click **Choose recording folder** and pick `Smile Interview Recordings`. Open a finished interview's review page and play the recording.
7. **Disconnect (30 s).**
   - In Bulk Resume Screening, click **Disconnect [email]** next to the Drive connection.
   - Open https://myaccount.google.com/permissions, show "Smile" and its access, and click **Remove access**.
8. **Outro (10 s).** Say: "Google user data is used only to provide these features, is never sold, and is never used to train AI models."

## After recording

1. Trim pauses only. Never cut, speed up or blur a consent screen.
2. Upload to YouTube as **Unlisted**. Open the link in a private window to check it plays.
3. In Cloud Console → Verification Center, paste the video link, the reviewer login and steps, and the privacy URL. Submit.
4. Reply in Google's email thread with the email below, once every manual item is filled in.

## Manual input still required before sending

These values are not in the codebase and must not be guessed:

1. **Demo video link.** The unlisted YouTube URL, after recording.
2. **Reviewer test account.** The email and password of the reviewer account.
3. **Your name and title** for the signature.
4. **LiveAvatar plan/tier.**
5. **AI data path for bulk resume screening.** In the portal code, OpenAI is called directly (official SDK, default `api.openai.com` endpoint). Bulk resume screening, however, runs in the n8n screener workflow. Confirm where that n8n instance is hosted and that its OpenAI node calls `api.openai.com` directly, then decide whether n8n must be listed as a processor. The draft below lists it so nothing is left out. Remove that line only if you confirm it does not apply.

## Reply email to Google

Send as a reply in the Google Third Party Data Safety Team thread.

**Subject:** Re: OAuth verification, Smile Recruitment Portal: scopes now match Cloud Console, updated privacy policy and new demo video

Hello Google Developer Team,

Thank you for your review. We have corrected the scope mismatch and made the following updates.

**Scopes:** The application no longer requests `drive.readonly` or any other restricted Drive scope. Production now requests exactly the four scopes configured in Cloud Console: `userinfo.email`, `drive.file`, `calendar.events` and `calendar.events.freebusy`. Resume import uses the Google Picker with `drive.file`, so the app can open only the files the user selects. `calendar.events.freebusy` is used only to check interview availability, and `calendar.events` only to create, update and cancel interview events. Users who connected Drive under the old scope must reconnect, and their old tokens are not used.

**Server-side access:** Our own service account (not a user consent flow) stores uploaded resumes in a folder it creates in our Shared Drive using `drive.file`, and keeps our recruitment records in spreadsheets we own. No user is asked for Google Sheets access.

**Updated privacy policy:** https://smile.mclinkgroup.com/privacy. It includes "How we protect Google user data" and "Use of AI with Google user data" sections.

**Third-party AI integrations that can receive Google user data**

| Provider | Plan / tier | Endpoint | Data received | Training |
| --- | --- | --- | --- | --- |
| OpenAI | API, paid pay-as-you-go (business API terms) | api.openai.com, model gpt-4.1-mini (resume screening); gpt-4o-mini by default (interview analysis) | Text of resume files the user selects with the Google Picker (drive.file); interview transcripts | Not used for training under OpenAI API terms. No opt-in to data sharing. |
| Vapi (phone interview platform) | Voice AI platform, plan [confirm] | [confirm Vapi endpoint] | Name, email address and phone number recorded on the application, and the role details and interview questions needed to run the call. For resumes imported from Google Drive (drive.file), our workflow automation (n8n) takes the phone number and email address from the resume text and the name from the file name when the application is created. The call transcript comes back to us. | Vapi's privacy policy allows training on call data. [Before sending: obtain Vapi's written confirmation that data from Google sources is excluded from training.] |
| n8n (workflow automation, our instance) | Service that routes resume files and application data between the portal, Google and OpenAI | n8n.srv1457709.hstgr.cloud | Resume files and extracted resume text | Passes data to OpenAI only for screening; not used for training. [Confirm hosting provider before sending.] |


Other providers (not receiving Google user data): LiveAvatar (live interview video and audio). *(Manual item 4: add plan/tier.)*

**Self-hosted or offline models:** None.

**Limited Use:** Google user data is used only to provide the user-facing features, is not sold, is not used for advertising, and is never used by us to create, train or improve generalized AI/ML models. Raw or derived data is not transferred to any service we know trains on it, except that Vapi, our phone interview provider, receives the name, email address and phone number of applicants whose details came from Google Drive resumes (see the processor table above). [Before sending: obtain Vapi's written confirmation that this data is excluded from training, or remove that exception and stop sending Drive-derived details to Vapi.]

**Demo video:** *(Manual item 1.)*

**Test account:** *(Manual item 2.)* No phone or card verification is required.

**Steps:**

1. Go to https://smile.mclinkgroup.com and sign in with the test account.
2. Open Resume Screening, then Bulk Resume Screening.
3. Click Connect Google Drive and approve the consent screen.
4. Click Choose from Google Drive, select one or more resume files, and confirm.
5. Start screening and view the scored results.
6. Open Settings, click Connect Google Calendar, approve, and schedule a face-to-face interview. The event appears in Google Calendar.
7. In Settings, under "Google Drive for Live Avatar recordings", click Connect Google Drive, approve, and choose a recording folder.
8. Back in Bulk Resume Screening, click Disconnect next to the connected Drive account. Access can also be removed at https://myaccount.google.com/permissions.

Best regards,

*(Manual item 3.)*, MPS Solutions Pte Ltd
