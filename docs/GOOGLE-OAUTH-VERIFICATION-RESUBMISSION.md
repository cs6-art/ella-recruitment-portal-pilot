# Google OAuth verification: video script and resubmission

Updated 2026-10-06. Shared copy: https://claude.ai/code/artifact/8cce01d3-40f8-4f64-9c38-38d9018f5271

## Overview

Re-record the demo video on production with every consent screen fully expanded, showing exactly four sensitive scopes. Google rejected the last video because the scopes were not fully visible and did not clearly match Cloud Console.

| Scope | Where the user grants it | What the video shows it doing |
| --- | --- | --- |
| drive.file | Bulk Resume Screening → Connect Google Drive; Settings → Google Drive for Live Avatar recordings | Picking resumes in the Google file chooser; saving recordings to a chosen folder |
| userinfo.email | Every Google connect | Showing which Google account is connected |
| calendar.freebusy | Settings → Connect Google Calendar | Checking when the recruiter is free |
| calendar.events | Settings → Connect Google Calendar | Creating the interview event |

Google Sheets is not in the video. Users are never asked for Sheets access: the portal's own records are written by the server's service account to spreadsheets McLink owns. Remove `spreadsheets` from Cloud Console if it is listed. The privacy policy has been updated to say this, and that change must be live before you record.

## Before you record

Allow about 20 minutes. Tick each item off before you press record.

- [ ] **Use the project being verified.** Record on `smile.mclinkgroup.com` (production), so the `client_id` in the video is the one under review. Do not use a separate Cloud project.
- [ ] **Cloud Console → Google Auth Platform → Data Access.** The sensitive scopes are exactly `userinfo.email`, `drive.file`, `calendar.events` and `calendar.freebusy`. Remove `spreadsheets` and any other Drive scope, then save.
- [ ] **Branding page.** App name, logo, home page `https://smile.mclinkgroup.com`, privacy URL `https://smile.mclinkgroup.com/privacy` and authorized domain `mclinkgroup.com` are correct.
- [ ] **Privacy policy deployed.** `/privacy` no longer lists Google Sheets as user data.
- [ ] **Demo Google account.** Use a demo Gmail account, not a personal one. Put 2 or 3 sample PDF resumes with made-up names in its Drive, and create an empty folder called `Smile Interview Recordings`.
- [ ] **Clear old access.** At https://myaccount.google.com/permissions, remove "Smile" if listed, so every consent screen appears in full.
- [ ] **HR portal account.** It can manage Settings, because only a settings administrator can connect Calendar.
- [ ] **Organization set-up.** One active role with Face-to-Face Interviews on, and at least one finished Live Avatar interview with a recording.
- [ ] **Disconnect in the portal.** Disconnect any existing Google Drive, Calendar and recording Drive connection.
- [ ] **Reviewer login.** A separate email and password account with no phone or card step, tested in a private window.
- [ ] **Screen.** Clean Chrome profile, 100% zoom, 1920×1080, English. Close other tabs, mute notifications, hide bookmarks. Keep the address bar visible throughout.
- [ ] **Recorder.** OBS, Loom or Windows Game Bar (Win+G). Narrate live or add captions afterwards.

## Scenes

Target length is 6 to 8 minutes. Record in this order, in one take if you can.

1. **Intro (15 s).** Show `https://smile.mclinkgroup.com` with the address bar visible.
   - Say: "This is the Smile Recruitment Portal, operated by MPS Solutions Pte Ltd. This video shows how the app requests and uses Google user data for OAuth client ID [your client ID]."
2. **Privacy policy (30 s).** Open `/privacy` and scroll to "Part 2: Google user data".
   - Pause on "What we access and why", "How we protect Google user data" and "Use of AI with Google user data".
   - Say: "The policy lists the four scopes we request and explains that Google data is never used to train AI models."
3. **Sign in (10 s).** Sign in to the portal with the HR account.
4. **Google Drive for resumes (about 2 min). This is the most important scene.**
   - Go to Resume Screening → Bulk Resume Screening and choose the role.
   - Click **Connect Google Drive** and choose the demo Google account.
   - On the consent screen, make sure the address bar shows `client_id=...`. Click into the address bar if it is cut off.
   - Expand every permission so each one is fully readable. Hold still for 5 to 8 seconds.
   - Say: "drive.file lets the portal open only the files the user picks in the Google file chooser. userinfo.email shows which account is connected."
   - Click **Continue** or **Allow**. The portal shows the connected email.
   - Click **Choose from Google Drive**, pick the sample resumes in the Google file chooser, and confirm.
   - Start screening. Show the files in the queue with Google Drive as the source, then show the scored result.
   - Say: "The resume text is sent to OpenAI only to score it against the role. It is not used to train AI models. A recruiter makes the decision."
5. **Google Calendar (about 1.5 min).**
   - Go to Settings and find the Google Calendar card. Getting Started → "Connect Google Calendar" also leads there.
   - Click **Connect Google Calendar** and choose the demo account.
   - Expand every permission and hold for 5 to 8 seconds with `client_id` visible.
   - Say: "calendar.freebusy checks when the recruiter is free. calendar.events creates, updates and cancels interview events."
   - Click **Allow**. The portal shows "Google Calendar connected."
   - Schedule a face-to-face interview, or book a slot from the candidate's booking link to show the free/busy check.
   - Open Google Calendar in a new tab and show the event the portal created.
6. **Google Drive for interview recordings (about 1 min).**
   - Go to Settings → "Google Drive for Live Avatar recordings".
   - Click **Connect Google Drive** and choose the demo account.
   - Expand every permission and hold. It shows the same `drive.file` and `userinfo.email` scopes.
   - Click **Allow**, then **Choose recording folder** and pick `Smile Interview Recordings`.
   - Say: "Interview recordings are saved only into the folder the organization chooses. drive.file means the portal can reach only that folder and the files it creates."
   - Open a finished interview's review page and play the recording.
7. **Note on Google Sheets (10 s, caption only).**
   - Caption: "The portal does not ask users for access to Google Sheets or any other Google service. Its own records are kept by our server in spreadsheets we own."
   - Do not open a spreadsheet or show a Sheets consent screen. There isn't one.
8. **Disconnect (30 s).**
   - In Bulk Resume Screening, click **Disconnect [email]** next to the Drive connection.
   - Open https://myaccount.google.com/permissions, show "Smile" and its access, and click **Remove access**.
   - Say: "Users can disconnect in the portal or revoke access at any time in their Google account."
9. **Outro (10 s).**
   - Say: "Google user data is used only to provide these features, is never sold, and is never used to train AI models."

## After recording

1. Trim pauses only. Never cut, speed up or blur a consent screen.
2. Upload to YouTube as **Unlisted**. Open the link in a private window to check it plays.
3. In Cloud Console → Verification Center, paste the video link, the reviewer login and steps, and the privacy URL. Submit.
4. Reply in Google's email thread with the email below, after filling in every placeholder.

## Check for these rejection reasons

- [ ] Every consent screen is fully expanded and held long enough to read.
- [ ] The four scopes in the video match the four in Cloud Console exactly.
- [ ] The `client_id` is readable and belongs to the project under review.
- [ ] Every scope shown is also used on screen.

## Reply email to Google

Send as a reply in the Google Third Party Data Safety Team thread. Fill in every value in square brackets first.

**Subject:** Re: OAuth verification, Smile Recruitment Portal: updated privacy policy, AI disclosures and new demo video

Hello Google Developer Team,

Thank you for your review. We have made the following updates.

**Updated privacy policy:** https://smile.mclinkgroup.com/privacy. It now includes a "How we protect Google user data" section (encryption in transit and at rest, least-privilege scopes, access control, secrets handling, retention, incident response) and a "Use of AI with Google user data" section.

**Third-party AI integrations that can receive Google user data**

| Provider | Plan / tier | Endpoint | Data received | Training |
| --- | --- | --- | --- | --- |
| OpenAI | API, paid pay-as-you-go (business API terms) | Chat Completions via api.openai.com, model gpt-5-mini | Text of resume files the user selects with the Google Picker (drive.file); interview transcripts | Not used for training under OpenAI API terms. No opt-in to data sharing. |

Other providers (not receiving Google user data): LiveAvatar (live interview video and audio), tier: [LiveAvatar plan].

**Aggregators, gateways or model hubs:** None. We call OpenAI directly. [Confirm before sending]

**Self-hosted or offline models:** None.

**Limited Use:** Google user data is used only to provide the user-facing features, is not sold, is not used for advertising, and is never used to create, train or improve generalized AI/ML models. Raw or derived data is not transferred to any service that trains on it.

**Scopes:** The scopes in the demo video match those configured in Cloud Console exactly: userinfo.email, drive.file, calendar.events, calendar.freebusy. The portal does not request any Google Sheets scope from users; its recruitment records are written by our own service account to sheets we own.

**Demo video:** [YouTube link]

**Test account:** [email] / [password] (no phone or card verification required)

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

[Your name], MPS Solutions Pte Ltd
