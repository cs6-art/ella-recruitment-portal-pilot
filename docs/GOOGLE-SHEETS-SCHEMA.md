# Google Sheets schema

Create these tabs and use the exact headers below. Header order may vary because
the portal maps by header name, but spelling must remain exact.

## Role_Requests

`Role_ID`, `Created_At`, `Status`, `Last_Updated_At`, `Last_Updated_By_Name`,
`Last_Updated_By_Email`, `Latest_Comments`, `Resume_Target_Status`,
`Requester_Name`, `Requester_Email`, `HOD_Email`, `Requester_Type`, `Request_Type`,
`Department`, `Job_Title`, `Number_Of_Vacancies`, `Reason_For_Request`,
`Replacement_Employee`, `Target_Hiring_Date`, `Reporting_Manager`,
`Work_Location`, `Employment_Type`, `Job_Responsibilities`, `Required_Skills`,
`Experience_Required`, `Education_Requirements`, `Preferred_Qualifications`,
`Role_Expectations`, `Salary_Min`, `Salary_Max`, `Work_Schedule`,
`Job_Description`, `Screening_Criteria`, `Initial_Interview_Questions`,
`AI_Interviewer_Name`, `AI_Interviewer_Behavior`,
`Required_Interview_Question_1`, `Required_Interview_Question_2`,
`Required_Interview_Question_3`, `Final_AI_Evaluation_Template`,
`HOD_Availability_Dates`, `HOD_Availability_Times`, `HOD_Availability_Slots`,
`Custom_Screening_Question_1`, `Custom_Screening_Question_2`,
`AI_Screening_Questions`, `Notice_Period_Requirement`,
`Voice_Interview_Availability_Mode`, `Voice_Interview_Slots`,
`Voice_Interview_Auto_Start_Date`, `Voice_Interview_Auto_End_Date`,
`Voice_Interview_Timezone`, `Voice_Interview_Slots_Generated_At`,
`Interview_Availability_Rules`,
`Salary_Expectation_Guidance`, `Application_Link`, `Posting_Confirmed`,
`Posted_At`, `Posted_By`,
`AI_System_Prompt`, `Initial_Interview_Booking_Link`,
`HOD_Interview_Booking_Link`, `Posting_Channels`,
`Evaluation_Fields`,
`Recruitment_Setup_Updated_At`, `Recruitment_Setup_Updated_By_Name`,
`Recruitment_Setup_Updated_By_Email`.

`AI_System_Prompt` stores the HR-editable Vapi template, including tokens such
as `{{candidate_name}}`, `{{interview_questions}}`, and `{{system_prompt}}`.
`VAPI_Resolved_System_Prompt` is the rendered prompt sent to the interview
workflow after the role criteria values are inserted. If the live workbook
does not yet have that column, n8n may keep the resolved value in its own
workflow payload, but it must use the editable template as the source of
truth.

`Evaluation_Fields` stores a JSON array containing the always-included score,
recommendation, strengths, and concerns fields plus any selected catalog or
custom fields.

Stage-based Recruitment Setup also uses these exact Role_Requests columns:
`Recruitment_Setup_Status`, `Salary_Disclosure_Status`,
`Experience_Requirement_Status`, `License_Requirement_Status`,
`HOD_Interview_Required`, `Recruitment_Ready_At`, `Recruitment_Ready_By`,
`Ready_For_Publishing_At`, `Ready_For_Publishing_By`, `Posted_At`, and
`Posted_By`.

`Recruitment_Setup_Status` is `Draft`, `Recruitment Ready`,
`Ready for Publishing`, or `Published`. Draft saves do not make a role
`Job Posted`. The other option columns must contain explicit values before
publishing: salary `Disclosed` or `Not disclosed`, experience `Required` or
`Not required`, license `Required`, `Preferred`, or `Not required`, and HOD
interview `Required` or `Not required`.

Recruitment Setup also uses `License_or_Certificate_Required`,
`Keywords_to_Look_For`, `Minimum_Years_of_Experience`,
`Transferable_Skills_Accepted`, `Salary_or_Budget_Range`,
`Earliest_Availability_Rule`, `Interview_Behavior`, and `Final_Interview_Venue`.

`Final_Interview_Venue` is the physical face-to-face interview location
(address, floor/room, arrival instructions, on-site contact). It is required
before publishing when `HOD_Interview_Required` is `Required`. The portal
writes it to the booked Google Calendar event's `location` and snapshots it to
`High_Match_Profile.Final_Interview_Venue` when HR approves the voice interview,
so the n8n face-to-face invitation email can include it.

The Management-approval step was removed (URS Phase 1). Role status values are
now `Draft`, `Pending HR Discussion`, `Approved`, `Recruitment Setup`,
`Job Posted`, plus `Returned for Revision`, `On Hold`, and `Rejected`.
`Pending Management Approval` no longer occurs; legacy rows carrying it still
display. `Approved_By` / `Approved_At` now record the HR reviewer.

`Initial_Interview_Questions` is the canonical numbered question list
(`Q1: …` newline `Q2: …`, blank slots dropped and renumbered). The same string
is embedded in `VAPI_Resolved_System_Prompt` and shown to HR, so the AI voice
evaluator can tie each answer to a question by its `Qn` number rather than by
transcript position.

New writes use only `Status` and `Last_Updated_At`. `Request_Status` and
`Updated_At` are read-only migration fallbacks and must not be added to new
workflow writes.

`HOD_Availability_Slots` stores a JSON array of structured windows containing
`date`, `startTime`, `endTime`, and `timezone`. The legacy availability columns
remain human-readable compatibility fields. Final interview slots are checked
against these structured windows when they exist; older roles without them
continue to support manual scheduling.

`Voice_Interview_Availability_Mode` is `none`, `manual`, or `automatic`.
Manual mode stores exact AI Voice Interview slots in `Voice_Interview_Slots`.
Automatic mode stores a date range and timezone; publishing generates weekday
slots from 9:00 AM to 5:00 PM using the configured voice-interview duration.
Generated slots are written to `Interview_Slots` and duplicate role/date/start
combinations are skipped on later publishes.

`Interview_Availability_Rules` is the preferred schedule source for new and
updated roles. It is a JSON array of active or archived rules. A recurring rule
contains `ruleId`, `roleId`, `interviewType`, `mode: "recurring"`,
`weekdays` (0 Sunday through 6 Saturday), `startTime`, `endTime`,
`slotDurationMinutes`, and `timezone`. A specific rule contains
`mode: "specific"` and `specificSlots` with `date`, `startTime`, `endTime`,
and `timezone`. Rules generate virtual availability on demand; they do not
create hundreds of rows in `Interview_Slots`. Existing legacy fields and rows
remain supported as a fallback.

## Role_Status_History

`History_ID`, `Role_ID`, `Changed_At`, `Changed_By_Name`, `Changed_By_Email`,
`Previous_Status`, `New_Status`, `Comments`, `Action_Source`,
`Action_Request_ID`, `Action`, `Access_Role`, `Department`,
`Resume_Target_Status`, `Notification_Status`, `Notification_Error`.

## Candidate_Status_History

`History_ID`, `Application_ID`, `Role_ID`, `Changed_At`, `Previous_Status`,
`New_Status`, `Stage`, `Action`, `Changed_By_Name`, `Changed_By_Email`,
`Comments`, `Rejection_Reason`, `Action_Source`.

## High_Match_Profile candidate fields

The portal reads and writes these candidate fields in `High_Match_Profile`:
`Application_ID`, `Role_ID`, `Candidate_Name`, `Email`, `Phone`,
`Contact_Number`, `Preferred_Mobile`, `Selected_Role`, `Department`,
`Resume_Text`, `Salary_Expectation`, `Notice_Period`,
`Availability`, `Skills_Assessment`, `Role_Expectations`,
`Application_Source`, `Final_Status`, `Resume_HR_Comments`,
`Voice_HR_Comments`, `Final_Interview_Comments`, `Final_Interview_Reviewer`,
`Final_Interview_Decision_Date`, `Resume_File_Id`, `Resume_File_Name`,
`Resume_File_Mime_Type`, `Resume_File_Size`, `Resume_File_SHA256`,
`Resume_File_Expires_At`, `Voice_Interview_Booking_Link`,
`Booking_Token_Status`, `Booking_Token_Expires_At`,
`Final_Interview_Booking_Link`, `Final_Interview_Booking_Token`,
`Final_Interview_Booking_Token_Hash`, `Final_Interview_Booking_Token_Expires_At`,
`Final_Interview_Booking_Token_Status`, `Final_Interview_Booking_Token_Used_At`,
`Final_Interview_Venue`, `Last_Updated`.

Final booking tokens are issued when HR approves the voice interview. The
portal writes a link using the current public app URL and marks the token
`Used` immediately after a final slot is booked. The booking page rejects
`Used`, `Booked`, `Expired`, and `Revoked` tokens.

## Interview_Slots

The booking calendar uses `Slot_ID`, `Interview_Type`, `Role_ID`, `Date`,
`Start_Time`, `End_Time`, `Timezone`, `Status`, `Application_ID`,
`Candidate_Name`, `Candidate_Email`, `Booked_At`, and `Last_Updated`.
`Status` may be `Available`, `Booked`, `Blocked`, `Expired`, or `Cancelled`.
`No Show` is retained as a backward-compatible appointment outcome. Rescheduling clears the
candidate fields on the old booked row and returns it to `Available`.
Final-interview rows also use `Google_Calendar_Event_ID`,
`Google_Calendar_Event_Link`, `Google_Calendar_Event_Status`, and
`Google_Calendar_Event_Error` for Calendar lifecycle tracking.

HR may mark a booked slot `No Show` only after its start time in the slot
timezone. The portal also updates the corresponding voice/final status in
`High_Match_Profile`; a completed interview cannot be changed to `No Show`.

Rules are read as virtual slots by the HR calendar and candidate booking page.
Candidate booking exposes only future `Available` times. Final-interview
virtual times are checked against the connected HOD Google Calendar before
they are shown and checked again immediately before reservation. A conflict is
never booked; legacy final rows are synchronized to `Blocked` by the calendar
workflow when a conflict is found. Past available rows are treated as
`Expired` in the read model so dashboards count only active or booked times.

Binary resume files, DOCX uploads, and base64-encoded resume blobs must not be
stored in Google Sheets. Keep file storage separate and store only metadata plus
extracted text in the sheet. The portal stores the binaries in Google Drive
(`RESUME_STORAGE_DRIVE_FOLDER_ID`), not on local disk — Vercel's filesystem
is read-only outside `/tmp`. That Drive folder must be shared with
`GOOGLE_SERVICE_ACCOUNT_EMAIL` (Editor access); expired files are not
downloadable.

## User_Directory

`Email`, `Full_Name`, `Access_Role`, `Department`, `Can_Create_Role`,
`Can_Review_Role`, `Can_Approve_Role`, `Can_Edit_Settings`,
`Can_Manage_Users`, `Active`.

`Can_Manage_Users` controls access to the User Accounts page and account
administration API. Existing rows without this column remain compatible: an
existing settings administrator is treated as a user administrator until the
row is saved with an explicit value.

## Settings

`Setting_Key`, `Setting_Value`, `Category`, `Description`, `Updated_At`,
`Updated_By`. Never store webhook secrets, service-account private keys, or
other credentials in this tab.

Beyond the built-in HR defaults, this tab also holds optional operational
configuration editable from Settings -> Infrastructure: the n8n webhook URLs
(`N8N_Role_Webhook_URL`, `N8N_Recruitment_Setup_Webhook_URL`,
`N8N_Role_Description_Parser_Webhook_URL`, `N8N_Candidate_Application_Webhook_URL`,
`N8N_Application_Invite_Email_Webhook_URL`, `N8N_Bulk_Resume_Upload_Webhook_URL`),
`App_URL`, `Resume_Screening_Invite_Base_URL`, `N8N_Bulk_Resume_Portal_Base_URL`,
`Resume_Storage_Drive_Folder_ID`, `Bulk_Resume_Drive_URL`,
`Allowed_Google_Domain`, `Booking_Link_Expiry_Days`,
`Resume_Screening_Link_Expiry_Days`, `Bulk_Resume_Upload_Concurrency`,
`Bulk_Resume_Notify_On_Success`, `Ella_Credit_Cost_CV_Analysis`,
`Ella_Credit_Cost_Phone_Interview`, `Ella_Credit_Discount_Threshold`,
`Ella_Credit_Discount_Percent`, `Voice_Call_Max_Attempts`, and
`Voice_Call_Retry_Gap_Hours`. A blank value falls back to the matching
environment variable, then to a built-in default; a non-empty value overrides
the environment. The portal seeds these rows automatically.

## Voice_Call_Queue

Written by the portal on booking and read by the n8n AI voice-calling
workflow. Columns used by the portal:

`Application_ID`, `Candidate_Name`, `Candidate_Email`,
`Voice_Interview_Scheduled_Date`, `Voice_Interview_Scheduled_Time`,
`Voice_Interview_Timezone`, `Applicant_Country`, `Preferred_Mobile`,
`Contact_Number`, `Role_ID`, `Voice_Call_Status`, `Voice_Call_Attempts`,
`Voice_Call_Max_Attempts`, `Voice_Call_Scheduled_At`, `Last_Updated`.

`Voice_Call_Status` lifecycle: `Scheduled` → `Queued` → `Calling` /
`Initiated` / `In Progress` → `Completed`, or `Retry Scheduled` (a missed call
with attempts remaining) → eventually `No Show` (terminal) or `Cancelled`
(rebooked / superseded).

**Attempt 1–N retry lifecycle (URS Phase 1).** The portal sets
`Voice_Call_Max_Attempts` from Settings (`Voice_Call_Max_Attempts`, default 3)
when it creates the row. When a call is missed and
`Voice_Call_Attempts < Voice_Call_Max_Attempts`, the portal (via the manual
"Mark No Show" action or the automatic past-day sweep) increments
`Voice_Call_Attempts`, sets `Voice_Call_Status = Retry Scheduled`, and pushes
`Voice_Call_Scheduled_At` forward by `Voice_Call_Retry_Gap_Hours` (default 24).
Only when the attempts are exhausted does it become a terminal `No Show`
(`Interview_Slots.Status = No Show`, `High_Match_Profile` voice status
`No Show`), at which point the candidate may rebook with the original link.
The n8n calling workflow must honour `Voice_Call_Max_Attempts > 1` and re-call
at `Voice_Call_Scheduled_At` for a `Retry Scheduled` row.

## Drive_Connections

`Email`, `Access_Token`, `Refresh_Token`, `Token_Expires_At`, `Scope`,
`Connected_At`, `Last_Updated`. One row per HR reviewer who connected their
Google Drive for resume import. `Access_Token` / `Refresh_Token` are
AES-256-GCM encrypted at rest (key derived from `SESSION_SECRET`, label
`drive-token-encryption`). Same shape as `Calendar_Connections` but a separate
tab so Drive and Calendar authorizations stay independent. The portal creates
this tab automatically on first connect. (Phase 2 will move both connection
tabs to Postgres.)

## Microsoft_Drive_Connections

`Email`, `Access_Token`, `Refresh_Token`, `Token_Expires_At`, `Scope`,
`Connected_At`, `Last_Updated`. One row per HR reviewer who connected their
Microsoft OneDrive for resume import. Identical shape to `Drive_Connections`,
kept in its own tab so the OneDrive authorization is fully independent of the
Google Drive and Calendar ones. `Access_Token` / `Refresh_Token` are
AES-256-GCM encrypted at rest (key derived from `SESSION_SECRET`, label
`microsoft-drive-token-encryption`). Microsoft Graph scope is the delegated
read-only `Files.Read` (plus `User.Read` / `offline_access`). The portal
creates this tab automatically on first connect.

## Ella_Credit_Ledger

`Entry_ID`, `Timestamp`, `Type`, `Event`, `Units`, `Credits_Delta`,
`Balance_After`, `Reference`, `Role_ID`, `Actor_Name`, `Actor_Email`, `Note`.

Append-only ledger for the org-wide Ella Credits balance. The portal creates
this tab automatically on first use, so it does not need to be pre-created;
the headers above are what it writes. `Type` is `TopUp` or `Deduction`;
`Event` is `manual_topup`, `manual_adjustment`, `cv_analysis`, or
`phone_interview`, `phone_interview_no_answer`, or
`phone_interview_incomplete`. The usable balance is the signed sum of every
`Credits_Delta`; `Balance_After` is written for audit convenience only and is
never trusted on read. AI CV analysis costs 1 credit per resume. A new AI voice
call is checked against the 10-credit maximum before dispatch, but is billed
only after its terminal outcome: 10 credits for a completed transcript, 8 for
an incomplete interview, and 5 for no answer/no-show. Admins adjust the
balance from Settings → Ella Credits.

## Optional Role_AI_Settings

`Role_ID`, `Job_Title`, `Department`, `License_or_Certificate_Required`,
`Keywords_to_Look_For`, `Minimum_Years_of_Experience`,
`Transferable_Skills_Accepted`, `Salary_Min`, `Salary_Max`,
`Earliest_Availability_Rule`, `Interview_Behavior`,
`Initial_Interview_Questions`, `AI_System_Prompt`, `Updated_At`,
`Updated_By_Name`, `Updated_By_Email`.
